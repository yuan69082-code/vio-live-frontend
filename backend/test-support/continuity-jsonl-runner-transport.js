import { statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const RUNNER_MODULE = 'tests.shared.continuity_contract_jsonl_runner';

function requiredEngineRepository(value = process.env.CONTINUITY_ENGINE_REPO) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      'CONTINUITY_ENGINE_REPO is required for the shared continuity acceptance tests.',
    );
  }
  const repository = resolve(value);
  if (!statSync(repository).isDirectory()) {
    throw new Error('CONTINUITY_ENGINE_REPO must point to a local Engine repository.');
  }
  if (!statSync(join(repository, 'tests', 'shared', 'continuity_contract_jsonl_runner.py')).isFile()) {
    throw new Error('The Engine shared contract JSONL Runner was not found.');
  }
  return repository;
}

function protocolError(message, cause = undefined) {
  return new Error(`Continuity JSONL Runner protocol failure: ${message}`, { cause });
}

export function createContinuityJsonlRunnerTransport({
  dataDir,
  engineRepository = process.env.CONTINUITY_ENGINE_REPO,
  pythonCommand = process.env.PYTHON || 'python',
  timeoutMs = 20_000,
} = {}) {
  const engineRepo = requiredEngineRepository(engineRepository);
  if (typeof dataDir !== 'string' || dataDir.trim().length === 0) {
    throw new Error('A controlled Engine data directory is required.');
  }

  const environment = {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPATH: [join(engineRepo, 'src'), process.env.PYTHONPATH]
      .filter(Boolean)
      .join(delimiter),
  };
  const child = spawn(
    pythonCommand,
    ['-m', RUNNER_MODULE, '--data-dir', resolve(dataDir)],
    {
      cwd: engineRepo,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let pending = null;
  let protocolFailure = null;
  let exitCode = null;
  let closing = false;
  let submissionCount = 0;
  const inputLines = [];
  const outputLines = [];

  function rejectPending(error) {
    if (!pending) return;
    clearTimeout(pending.timeout);
    const { reject } = pending;
    pending = null;
    reject(error);
  }

  function fail(error) {
    if (!protocolFailure) protocolFailure = error;
    rejectPending(error);
    if (child.exitCode === null && !child.killed) child.kill();
  }

  function consumeLine(line) {
    if (line.length === 0) {
      fail(protocolError('stdout contained a blank line.'));
      return;
    }
    if (!pending) {
      fail(protocolError('stdout contained an unsolicited result line.'));
      return;
    }
    let envelope;
    try {
      envelope = JSON.parse(line);
    } catch (error) {
      fail(protocolError('stdout line was not valid JSON.', error));
      return;
    }
    clearTimeout(pending.timeout);
    const { resolve: resolveResult } = pending;
    pending = null;
    outputLines.push(line);
    resolveResult(envelope);
  }

  child.stdout.on('data', (chunk) => {
    try {
      stdoutBuffer += decoder.decode(chunk, { stream: true });
    } catch (error) {
      fail(protocolError('stdout was not valid UTF-8.', error));
      return;
    }
    for (;;) {
      const newline = stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line.endsWith('\r')) {
        fail(protocolError('stdout used CRLF instead of the required LF framing.'));
        return;
      }
      consumeLine(line);
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString('utf8');
    fail(protocolError(`stderr was not empty: ${stderrBuffer.trim()}`));
  });

  child.on('error', (error) => {
    fail(protocolError('the Python process could not be started.', error));
  });

  const exited = new Promise((resolveExit) => {
    child.on('close', (code) => {
      exitCode = code;
      try {
        stdoutBuffer += decoder.decode();
      } catch (error) {
        if (!protocolFailure) protocolFailure = protocolError('stdout ended with invalid UTF-8.', error);
      }
      if (stdoutBuffer.length > 0 && !protocolFailure) {
        protocolFailure = protocolError('stdout ended with an incomplete JSONL line.');
      }
      const unexpected = !closing || code !== 0;
      if (unexpected && !protocolFailure) {
        protocolFailure = protocolError(`Runner exited with code ${code}.`);
      }
      rejectPending(protocolFailure ?? protocolError(`Runner exited with code ${code}.`));
      resolveExit();
    });
  });

  async function submit(request) {
    if (protocolFailure) throw protocolFailure;
    if (exitCode !== null) throw protocolError(`Runner already exited with code ${exitCode}.`);
    if (pending) throw protocolError('only one in-flight JSONL request is allowed.');
    const line = JSON.stringify(request);
    if (line.includes('\n') || line.includes('\r')) {
      throw protocolError('serialized input was not a single physical line.');
    }
    submissionCount += 1;
    inputLines.push(line);
    return new Promise((resolveResult, reject) => {
      const timeout = setTimeout(() => {
        fail(protocolError(`Runner did not answer within ${timeoutMs}ms.`));
      }, timeoutMs);
      pending = { resolve: resolveResult, reject, timeout };
      child.stdin.write(Buffer.from(`${line}\n`, 'utf8'), (error) => {
        if (error) fail(protocolError('stdin write failed.', error));
      });
    });
  }

  async function close() {
    if (!closing && exitCode === null) {
      closing = true;
      child.stdin.end();
    }
    await exited;
    if (protocolFailure) throw protocolFailure;
    if (stderrBuffer.length > 0) throw protocolError('stderr was not empty.');
    if (exitCode !== 0) throw protocolError(`Runner exited with code ${exitCode}.`);
  }

  async function terminate() {
    closing = true;
    if (child.exitCode === null && !child.killed) child.kill();
    await exited;
  }

  return Object.freeze({
    mode: 'engine-jsonl-shared-test',
    testOnly: true,
    submit,
    close,
    terminate,
    get submissionCount() {
      return submissionCount;
    },
    get inputLines() {
      return [...inputLines];
    },
    get outputLines() {
      return [...outputLines];
    },
    get stderr() {
      return stderrBuffer;
    },
  });
}

export function requireContinuityEngineRepository(value) {
  return requiredEngineRepository(value);
}
