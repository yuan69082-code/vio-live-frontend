import { ConflictError } from '../../core/errors.js';

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

function mapBinding(row) {
  if (!row) return null;
  return {
    fixture: JSON.parse(row.fixture_json),
    bindingFixtureHash: row.binding_fixture_hash,
    loadedAt: row.loaded_at,
  };
}

function mapRequest(row) {
  if (!row) return null;
  return {
    requestId: row.request_id,
    requestHash: row.request_hash,
    bindingId: row.binding_id,
    bindingVersion: row.binding_version,
    bindingFixtureHash: row.binding_fixture_hash,
    userId: row.user_id,
    assistantId: row.assistant_id,
    subjectId: row.engine_subject_id,
    expectedEngineRevision: row.expected_engine_revision,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    messageVersionId: row.message_version_id,
    observationId: row.observation_id,
    sourceEventId: row.source_event_id,
    factId: row.fact_id,
    createdAt: row.created_at,
    logicalRequest: JSON.parse(row.logical_request_json),
    recordedAt: row.recorded_at,
  };
}

export function createSqliteContinuityIntegrationRepository(connection) {
  const findBindingStatement = connection.prepare(`
    SELECT fixture_json, binding_fixture_hash, loaded_at
    FROM continuity_first_round_binding_fixtures
    WHERE binding_id = 'binding-001'
  `);
  const insertBindingStatement = connection.prepare(`
    INSERT INTO continuity_first_round_binding_fixtures (
      binding_id,
      schema_version,
      user_id,
      assistant_id,
      engine_subject_id,
      binding_version,
      status,
      created_at,
      effective_at,
      replaced_binding_id,
      binding_fixture_hash,
      fixture_json,
      loaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findRequestStatement = connection.prepare(`
    SELECT
      request_id,
      request_hash,
      binding_id,
      binding_version,
      binding_fixture_hash,
      user_id,
      assistant_id,
      engine_subject_id,
      expected_engine_revision,
      conversation_id,
      message_id,
      message_version_id,
      observation_id,
      source_event_id,
      fact_id,
      created_at,
      logical_request_json,
      recorded_at
    FROM continuity_first_round_requests
    WHERE request_id = ?
  `);
  const insertRequestStatement = connection.prepare(`
    INSERT INTO continuity_first_round_requests (
      request_id,
      request_hash,
      binding_id,
      binding_version,
      binding_fixture_hash,
      user_id,
      assistant_id,
      engine_subject_id,
      expected_engine_revision,
      conversation_id,
      message_id,
      message_version_id,
      observation_id,
      source_event_id,
      fact_id,
      created_at,
      logical_request_json,
      recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return Object.freeze({
    findFixedBinding() {
      return mapBinding(findBindingStatement.get());
    },
    insertFixedBinding({ fixture, bindingFixtureHash, fixtureJson, loadedAt }) {
      try {
        insertBindingStatement.run(
          fixture.bindingId,
          fixture.schemaVersion,
          fixture.userId,
          fixture.assistantId,
          fixture.subjectId,
          fixture.bindingVersion,
          fixture.status,
          fixture.createdAt,
          fixture.effectiveAt,
          fixture.replacedBindingId,
          bindingFixtureHash,
          fixtureJson,
          loadedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Fixed first-round SubjectBinding could not be loaded.');
        }
        throw error;
      }
      return mapBinding(findBindingStatement.get());
    },
    findRequestById(requestId) {
      return mapRequest(findRequestStatement.get(requestId));
    },
    insertRequest(record) {
      try {
        insertRequestStatement.run(
          record.requestId,
          record.requestHash,
          record.bindingId,
          record.bindingVersion,
          record.bindingFixtureHash,
          record.userId,
          record.assistantId,
          record.subjectId,
          record.expectedEngineRevision,
          record.conversationId,
          record.messageId,
          record.messageVersionId,
          record.observationId,
          record.sourceEventId,
          record.factId,
          record.createdAt,
          record.logicalRequestJson,
          record.recordedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('First-round continuity request conflicts with a stored fact.');
        }
        throw error;
      }
      return mapRequest(findRequestStatement.get(record.requestId));
    },
  });
}
