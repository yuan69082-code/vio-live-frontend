function parseJson(value) {
  return JSON.parse(value);
}

function mapWakeRule(row) {
  if (!row) return null;
  return {
    wakeId: row.wake_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    wakeType: row.wake_type,
    status: row.status,
    triggerCondition: parseJson(row.trigger_condition_json),
    userAuthorization: row.authorization_status,
    runtime: {
      microphonePermission: 'not_connected',
      systemWake: 'not_connected',
      triggerExecution: 'not_performed',
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPromptRule(row) {
  if (!row) return null;
  return {
    promptRuleId: row.prompt_rule_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    name: row.name,
    priority: row.priority,
    triggerEventType: row.trigger_event_type,
    condition: parseJson(row.condition_json),
    requiresConfirmation: row.requires_confirmation === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPromptRecord(row) {
  if (!row) return null;
  return {
    promptRecordId: row.prompt_record_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    promptRuleId: row.prompt_rule_id,
    triggerEventId: row.trigger_event_id,
    priority: row.priority,
    status: row.status,
    securityAuditLogId: row.security_audit_log_id,
    deliveryStatus: row.delivery_status,
    modelCallStatus: row.model_call_status,
    createdAt: row.created_at,
  };
}

function mapTokenBudget(row) {
  if (!row) return null;
  return {
    tokenBudgetId: row.token_budget_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    dailyTokenLimit: row.daily_token_limit,
    sessionTokenLimit: row.session_token_limit,
    overagePolicy: row.overage_policy,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTokenUsage(row) {
  if (!row) return null;
  return {
    tokenUsageId: row.token_usage_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    tokenBudgetId: row.token_budget_id,
    budgetSessionId: row.budget_session_id,
    modelId: row.model_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    usageSource: row.usage_source,
    modelCallStatus: row.model_call_status,
    billingStatus: row.billing_status,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  };
}

function mapBackgroundPolicy(row) {
  if (!row) return null;
  return {
    backgroundPolicyId: row.background_policy_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    runState: row.run_state,
    backgroundEnabled: row.background_enabled === 1,
    limits: {
      maxWakeupsPerHour: row.max_wakeups_per_hour,
      maxPromptsPerHour: row.max_prompts_per_hour,
      allowedWakeTypes: parseJson(row.allowed_wake_types_json),
      quietHours: row.quiet_hours_start === null ? null : {
        start: row.quiet_hours_start,
        end: row.quiet_hours_end,
      },
    },
    runtime: {
      scheduler: 'not_connected',
      backgroundExecution: 'not_performed',
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSqliteProactiveInteractionRepository(connection) {
  const findWake = connection.prepare(`
    SELECT * FROM wake_rules WHERE user_id = ? AND subject_id = ? AND wake_id = ?
  `);
  const insertWake = connection.prepare(`
    INSERT INTO wake_rules (
      wake_id, user_id, subject_id, wake_type, status, trigger_condition_json,
      authorization_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateWake = connection.prepare(`
    UPDATE wake_rules SET status = ?, authorization_status = ?, updated_at = ?
    WHERE user_id = ? AND subject_id = ? AND wake_id = ?
  `);

  const findPromptRule = connection.prepare(`
    SELECT * FROM proactive_prompt_rules
    WHERE user_id = ? AND subject_id = ? AND prompt_rule_id = ?
  `);
  const insertPromptRule = connection.prepare(`
    INSERT INTO proactive_prompt_rules (
      prompt_rule_id, user_id, subject_id, name, priority, trigger_event_type,
      condition_json, requires_confirmation, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updatePromptRule = connection.prepare(`
    UPDATE proactive_prompt_rules SET
      priority = ?, requires_confirmation = ?, status = ?, updated_at = ?
    WHERE user_id = ? AND subject_id = ? AND prompt_rule_id = ?
  `);
  const insertPromptRecord = connection.prepare(`
    INSERT INTO proactive_prompt_records (
      prompt_record_id, user_id, subject_id, prompt_rule_id, trigger_event_id,
      priority, status, security_audit_log_id, delivery_status,
      model_call_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findPromptRecord = connection.prepare(`
    SELECT * FROM proactive_prompt_records
    WHERE user_id = ? AND subject_id = ? AND prompt_record_id = ?
  `);

  const findBudget = connection.prepare(`
    SELECT * FROM token_budgets WHERE user_id = ? AND subject_id = ?
  `);
  const upsertBudget = connection.prepare(`
    INSERT INTO token_budgets (
      token_budget_id, user_id, subject_id, daily_token_limit,
      session_token_limit, overage_policy, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, subject_id) DO UPDATE SET
      daily_token_limit = excluded.daily_token_limit,
      session_token_limit = excluded.session_token_limit,
      overage_policy = excluded.overage_policy,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);
  const insertUsage = connection.prepare(`
    INSERT INTO token_usage_records (
      token_usage_id, user_id, subject_id, token_budget_id, budget_session_id,
      model_id, input_tokens, output_tokens, total_tokens, usage_source,
      model_call_status, billing_status, occurred_at, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findUsage = connection.prepare(`
    SELECT * FROM token_usage_records
    WHERE user_id = ? AND subject_id = ? AND token_usage_id = ?
  `);
  const summarizeDay = connection.prepare(`
    SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM token_usage_records
    WHERE user_id = ? AND subject_id = ? AND occurred_at >= ? AND occurred_at < ?
  `);
  const summarizeSession = connection.prepare(`
    SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM token_usage_records
    WHERE user_id = ? AND subject_id = ? AND budget_session_id = ?
  `);

  const findBackground = connection.prepare(`
    SELECT * FROM assistant_background_policies WHERE user_id = ? AND subject_id = ?
  `);
  const upsertBackground = connection.prepare(`
    INSERT INTO assistant_background_policies (
      background_policy_id, user_id, subject_id, run_state, background_enabled,
      max_wakeups_per_hour, max_prompts_per_hour, allowed_wake_types_json,
      quiet_hours_start, quiet_hours_end, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, subject_id) DO UPDATE SET
      run_state = excluded.run_state,
      background_enabled = excluded.background_enabled,
      max_wakeups_per_hour = excluded.max_wakeups_per_hour,
      max_prompts_per_hour = excluded.max_prompts_per_hour,
      allowed_wake_types_json = excluded.allowed_wake_types_json,
      quiet_hours_start = excluded.quiet_hours_start,
      quiet_hours_end = excluded.quiet_hours_end,
      updated_at = excluded.updated_at
  `);

  return {
    insertWakeRule(rule) {
      insertWake.run(
        rule.wakeId, rule.userId, rule.subjectId, rule.wakeType, rule.status,
        JSON.stringify(rule.triggerCondition), rule.userAuthorization,
        rule.createdAt, rule.updatedAt,
      );
      return mapWakeRule(findWake.get(rule.userId, rule.subjectId, rule.wakeId));
    },
    findWakeRule(userId, subjectId, wakeId) {
      return mapWakeRule(findWake.get(userId, subjectId, wakeId));
    },
    listWakeRules(userId, subjectId) {
      return connection.prepare(`
        SELECT * FROM wake_rules WHERE user_id = ? AND subject_id = ?
        ORDER BY updated_at DESC, wake_id
      `).all(userId, subjectId).map(mapWakeRule);
    },
    updateWakeRule(rule) {
      updateWake.run(
        rule.status, rule.userAuthorization, rule.updatedAt,
        rule.userId, rule.subjectId, rule.wakeId,
      );
      return mapWakeRule(findWake.get(rule.userId, rule.subjectId, rule.wakeId));
    },
    insertPromptRule(rule) {
      insertPromptRule.run(
        rule.promptRuleId, rule.userId, rule.subjectId, rule.name, rule.priority,
        rule.triggerEventType, JSON.stringify(rule.condition),
        rule.requiresConfirmation ? 1 : 0, rule.status, rule.createdAt, rule.updatedAt,
      );
      return mapPromptRule(findPromptRule.get(
        rule.userId, rule.subjectId, rule.promptRuleId,
      ));
    },
    findPromptRule(userId, subjectId, promptRuleId) {
      return mapPromptRule(findPromptRule.get(userId, subjectId, promptRuleId));
    },
    listPromptRules(userId, subjectId) {
      return connection.prepare(`
        SELECT * FROM proactive_prompt_rules WHERE user_id = ? AND subject_id = ?
        ORDER BY CASE priority
          WHEN 'urgent' THEN 1 WHEN 'important' THEN 2
          WHEN 'normal' THEN 3 ELSE 4 END,
          updated_at DESC, prompt_rule_id
      `).all(userId, subjectId).map(mapPromptRule);
    },
    updatePromptRule(rule) {
      updatePromptRule.run(
        rule.priority, rule.requiresConfirmation ? 1 : 0, rule.status,
        rule.updatedAt, rule.userId, rule.subjectId, rule.promptRuleId,
      );
      return mapPromptRule(findPromptRule.get(
        rule.userId, rule.subjectId, rule.promptRuleId,
      ));
    },
    insertPromptRecord(record) {
      insertPromptRecord.run(
        record.promptRecordId, record.userId, record.subjectId, record.promptRuleId,
        record.triggerEventId, record.priority, record.status,
        record.securityAuditLogId, 'not_delivered', 'not_performed', record.createdAt,
      );
      return mapPromptRecord(findPromptRecord.get(
        record.userId, record.subjectId, record.promptRecordId,
      ));
    },
    listPromptRecords(userId, subjectId) {
      return connection.prepare(`
        SELECT * FROM proactive_prompt_records WHERE user_id = ? AND subject_id = ?
        ORDER BY created_at DESC, prompt_record_id DESC LIMIT 100
      `).all(userId, subjectId).map(mapPromptRecord);
    },
    findTokenBudget(userId, subjectId) {
      return mapTokenBudget(findBudget.get(userId, subjectId));
    },
    upsertTokenBudget(budget) {
      upsertBudget.run(
        budget.tokenBudgetId, budget.userId, budget.subjectId,
        budget.dailyTokenLimit, budget.sessionTokenLimit, budget.overagePolicy,
        budget.status, budget.createdAt, budget.updatedAt,
      );
      return mapTokenBudget(findBudget.get(budget.userId, budget.subjectId));
    },
    insertTokenUsage(record) {
      insertUsage.run(
        record.tokenUsageId, record.userId, record.subjectId, record.tokenBudgetId,
        record.budgetSessionId, record.modelId, record.inputTokens,
        record.outputTokens, record.totalTokens, 'explicit_api_input',
        'not_performed_by_platform', 'not_billed', record.occurredAt, record.recordedAt,
      );
      return mapTokenUsage(findUsage.get(
        record.userId, record.subjectId, record.tokenUsageId,
      ));
    },
    listTokenUsage(userId, subjectId) {
      return connection.prepare(`
        SELECT * FROM token_usage_records WHERE user_id = ? AND subject_id = ?
        ORDER BY occurred_at DESC, token_usage_id DESC LIMIT 100
      `).all(userId, subjectId).map(mapTokenUsage);
    },
    summarizeTokenUsage(userId, subjectId, dayStart, nextDayStart, budgetSessionId) {
      return {
        dailyUsed: summarizeDay.get(userId, subjectId, dayStart, nextDayStart).total_tokens,
        sessionUsed: summarizeSession.get(
          userId, subjectId, budgetSessionId,
        ).total_tokens,
      };
    },
    findBackgroundPolicy(userId, subjectId) {
      return mapBackgroundPolicy(findBackground.get(userId, subjectId));
    },
    upsertBackgroundPolicy(policy) {
      upsertBackground.run(
        policy.backgroundPolicyId, policy.userId, policy.subjectId,
        policy.runState, policy.backgroundEnabled ? 1 : 0,
        policy.limits.maxWakeupsPerHour, policy.limits.maxPromptsPerHour,
        JSON.stringify(policy.limits.allowedWakeTypes),
        policy.limits.quietHours?.start ?? null,
        policy.limits.quietHours?.end ?? null,
        policy.createdAt, policy.updatedAt,
      );
      return mapBackgroundPolicy(findBackground.get(policy.userId, policy.subjectId));
    },
  };
}
