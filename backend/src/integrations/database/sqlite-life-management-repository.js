function parseJson(value) {
  return JSON.parse(value);
}

function formatMoney(amountMinor) {
  return (amountMinor / 100).toFixed(2);
}

function mapFinancialRecord(row) {
  if (!row) return null;
  return {
    financialRecordId: row.financial_record_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    entryType: row.entry_type,
    category: row.category,
    amount: formatMoney(row.amount_minor),
    currency: row.currency,
    occurredAt: row.occurred_at,
    note: row.note,
    createdAt: row.created_at,
  };
}

function mapBudget(row) {
  if (!row) return null;
  return {
    budgetId: row.budget_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    month: row.month,
    category: row.category,
    amount: formatMoney(row.amount_minor),
    currency: row.currency,
    reminderRule: parseJson(row.reminder_rule_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCalendarEntry(row) {
  if (!row) return null;
  return {
    calendarEntryId: row.calendar_entry_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    entryType: row.entry_type,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    note: row.note,
    reminderRule: parseJson(row.reminder_rule_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBodyRecord(row) {
  if (!row) return null;
  return {
    bodyRecordId: row.body_record_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    weightKg: row.weight_kg,
    bustCm: row.bust_cm,
    waistCm: row.waist_cm,
    hipCm: row.hip_cm,
    aiSuggestion: row.ai_suggestion,
    suggestionSource: row.ai_suggestion === null ? null : 'explicit_api_input',
    measuredAt: row.measured_at,
    createdAt: row.created_at,
  };
}

function mapBodyGoal(row) {
  if (!row) return null;
  return {
    bodyGoalId: row.body_goal_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    targetWeightKg: row.target_weight_kg,
    targetBustCm: row.target_bust_cm,
    targetWaistCm: row.target_waist_cm,
    targetHipCm: row.target_hip_cm,
    targetDate: row.target_date,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLocalMemory(row) {
  if (!row) return null;
  return {
    memoryId: row.memory_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    title: row.title,
    content: row.content,
    participatesInContext: row.participates_in_context === 1,
    exportMarked: row.export_marked === 1,
    storageScope: 'user_local_memory',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSqliteLifeManagementRepository(connection) {
  const insertFinancial = connection.prepare(`
    INSERT INTO life_financial_records (
      financial_record_id, user_id, subject_id, entry_type, category,
      amount_minor, currency, occurred_at, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findFinancial = connection.prepare(`
    SELECT * FROM life_financial_records
    WHERE user_id = ? AND subject_id = ? AND financial_record_id = ?
  `);
  const categorySummary = connection.prepare(`
    SELECT entry_type, category, currency,
      COUNT(*) AS record_count, SUM(amount_minor) AS total_minor
    FROM life_financial_records
    WHERE user_id = ? AND subject_id = ?
      AND occurred_at >= ? AND occurred_at <= ?
    GROUP BY entry_type, category, currency
    ORDER BY entry_type, category, currency
  `);
  const monthlySummary = connection.prepare(`
    SELECT currency,
      COUNT(*) AS record_count,
      SUM(CASE WHEN entry_type = 'income' THEN amount_minor ELSE 0 END) AS income_minor,
      SUM(CASE WHEN entry_type = 'expense' THEN amount_minor ELSE 0 END) AS expense_minor
    FROM life_financial_records
    WHERE user_id = ? AND subject_id = ? AND substr(occurred_at, 1, 7) = ?
    GROUP BY currency
    ORDER BY currency
  `);
  const upsertBudget = connection.prepare(`
    INSERT INTO life_budgets (
      budget_id, user_id, subject_id, month, category, amount_minor, currency,
      reminder_rule_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, subject_id, month, category) DO UPDATE SET
      amount_minor = excluded.amount_minor,
      currency = excluded.currency,
      reminder_rule_json = excluded.reminder_rule_json,
      updated_at = excluded.updated_at
  `);
  const findBudgetScope = connection.prepare(`
    SELECT * FROM life_budgets
    WHERE user_id = ? AND subject_id = ? AND month = ? AND category = ?
  `);

  const insertCalendar = connection.prepare(`
    INSERT INTO life_calendar_entries (
      calendar_entry_id, user_id, subject_id, entry_type, title, starts_at,
      ends_at, note, reminder_rule_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findCalendar = connection.prepare(`
    SELECT * FROM life_calendar_entries
    WHERE user_id = ? AND subject_id = ? AND calendar_entry_id = ?
  `);
  const updateCalendar = connection.prepare(`
    UPDATE life_calendar_entries SET
      entry_type = ?, title = ?, starts_at = ?, ends_at = ?, note = ?,
      reminder_rule_json = ?, updated_at = ?
    WHERE user_id = ? AND subject_id = ? AND calendar_entry_id = ?
  `);

  const insertBodyRecord = connection.prepare(`
    INSERT INTO life_body_records (
      body_record_id, user_id, subject_id, weight_kg, bust_cm, waist_cm,
      hip_cm, ai_suggestion, measured_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findBodyRecord = connection.prepare(`
    SELECT * FROM life_body_records
    WHERE user_id = ? AND subject_id = ? AND body_record_id = ?
  `);
  const upsertBodyGoal = connection.prepare(`
    INSERT INTO life_body_goals (
      body_goal_id, user_id, subject_id, target_weight_kg, target_bust_cm,
      target_waist_cm, target_hip_cm, target_date, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, subject_id) DO UPDATE SET
      target_weight_kg = excluded.target_weight_kg,
      target_bust_cm = excluded.target_bust_cm,
      target_waist_cm = excluded.target_waist_cm,
      target_hip_cm = excluded.target_hip_cm,
      target_date = excluded.target_date,
      note = excluded.note,
      updated_at = excluded.updated_at
  `);
  const findBodyGoal = connection.prepare(`
    SELECT * FROM life_body_goals WHERE user_id = ? AND subject_id = ?
  `);

  const insertMemory = connection.prepare(`
    INSERT INTO local_memories (
      memory_id, user_id, subject_id, title, content, participates_in_context,
      export_marked, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findMemory = connection.prepare(`
    SELECT * FROM local_memories
    WHERE user_id = ? AND subject_id = ? AND memory_id = ?
  `);
  const updateMemoryFlags = connection.prepare(`
    UPDATE local_memories SET participates_in_context = ?, export_marked = ?, updated_at = ?
    WHERE user_id = ? AND subject_id = ? AND memory_id = ?
  `);

  return {
    insertFinancialRecord(record) {
      insertFinancial.run(
        record.financialRecordId, record.userId, record.subjectId, record.entryType,
        record.category, record.amountMinor, record.currency, record.occurredAt,
        record.note, record.createdAt,
      );
      return mapFinancialRecord(findFinancial.get(
        record.userId, record.subjectId, record.financialRecordId,
      ));
    },
    listFinancialRecords({ userId, subjectId, entryType, category, from, to, limit }) {
      const conditions = ['user_id = ?', 'subject_id = ?'];
      const parameters = [userId, subjectId];
      if (entryType) { conditions.push('entry_type = ?'); parameters.push(entryType); }
      if (category) { conditions.push('category = ?'); parameters.push(category); }
      if (from) { conditions.push('occurred_at >= ?'); parameters.push(from); }
      if (to) { conditions.push('occurred_at <= ?'); parameters.push(to); }
      parameters.push(limit);
      return connection.prepare(`
        SELECT * FROM life_financial_records
        WHERE ${conditions.join(' AND ')}
        ORDER BY occurred_at DESC, financial_record_id DESC LIMIT ?
      `).all(...parameters).map(mapFinancialRecord);
    },
    summarizeFinancialCategories(userId, subjectId, from, to) {
      return categorySummary.all(userId, subjectId, from, to).map((row) => ({
        entryType: row.entry_type,
        category: row.category,
        currency: row.currency,
        recordCount: row.record_count,
        totalAmount: formatMoney(row.total_minor),
      }));
    },
    summarizeFinancialMonth(userId, subjectId, month) {
      return monthlySummary.all(userId, subjectId, month).map((row) => ({
        currency: row.currency,
        recordCount: row.record_count,
        incomeAmount: formatMoney(row.income_minor),
        expenseAmount: formatMoney(row.expense_minor),
        netAmount: formatMoney(row.income_minor - row.expense_minor),
      }));
    },
    upsertBudget(budget) {
      upsertBudget.run(
        budget.budgetId, budget.userId, budget.subjectId, budget.month, budget.category,
        budget.amountMinor, budget.currency, JSON.stringify(budget.reminderRule),
        budget.createdAt, budget.updatedAt,
      );
      return mapBudget(findBudgetScope.get(
        budget.userId, budget.subjectId, budget.month, budget.category,
      ));
    },
    listBudgets({ userId, subjectId, month, limit }) {
      return connection.prepare(`
        SELECT * FROM life_budgets
        WHERE user_id = ? AND subject_id = ? AND (? IS NULL OR month = ?)
        ORDER BY month DESC, category LIMIT ?
      `).all(userId, subjectId, month, month, limit).map(mapBudget);
    },
    insertCalendarEntry(entry) {
      insertCalendar.run(
        entry.calendarEntryId, entry.userId, entry.subjectId, entry.entryType,
        entry.title, entry.startsAt, entry.endsAt, entry.note,
        JSON.stringify(entry.reminderRule), entry.createdAt, entry.updatedAt,
      );
      return mapCalendarEntry(findCalendar.get(
        entry.userId, entry.subjectId, entry.calendarEntryId,
      ));
    },
    findCalendarEntry(userId, subjectId, calendarEntryId) {
      return mapCalendarEntry(findCalendar.get(userId, subjectId, calendarEntryId));
    },
    updateCalendarEntry(entry) {
      updateCalendar.run(
        entry.entryType, entry.title, entry.startsAt, entry.endsAt, entry.note,
        JSON.stringify(entry.reminderRule), entry.updatedAt, entry.userId,
        entry.subjectId, entry.calendarEntryId,
      );
      return mapCalendarEntry(findCalendar.get(
        entry.userId, entry.subjectId, entry.calendarEntryId,
      ));
    },
    listCalendarEntries({ userId, subjectId, entryType, from, to, limit }) {
      return connection.prepare(`
        SELECT * FROM life_calendar_entries
        WHERE user_id = ? AND subject_id = ?
          AND (? IS NULL OR entry_type = ?)
          AND (? IS NULL OR starts_at >= ?)
          AND (? IS NULL OR starts_at <= ?)
        ORDER BY starts_at DESC, calendar_entry_id DESC LIMIT ?
      `).all(
        userId, subjectId, entryType, entryType, from, from, to, to, limit,
      ).map(mapCalendarEntry);
    },
    insertBodyRecord(record) {
      insertBodyRecord.run(
        record.bodyRecordId, record.userId, record.subjectId, record.weightKg,
        record.bustCm, record.waistCm, record.hipCm, record.aiSuggestion,
        record.measuredAt, record.createdAt,
      );
      return mapBodyRecord(findBodyRecord.get(
        record.userId, record.subjectId, record.bodyRecordId,
      ));
    },
    listBodyRecords({ userId, subjectId, from, to, limit, ascending = false }) {
      const direction = ascending ? 'ASC' : 'DESC';
      return connection.prepare(`
        SELECT * FROM life_body_records
        WHERE user_id = ? AND subject_id = ?
          AND (? IS NULL OR measured_at >= ?)
          AND (? IS NULL OR measured_at <= ?)
        ORDER BY measured_at ${direction}, body_record_id ${direction} LIMIT ?
      `).all(userId, subjectId, from, from, to, to, limit).map(mapBodyRecord);
    },
    upsertBodyGoal(goal) {
      upsertBodyGoal.run(
        goal.bodyGoalId, goal.userId, goal.subjectId, goal.targetWeightKg,
        goal.targetBustCm, goal.targetWaistCm, goal.targetHipCm, goal.targetDate,
        goal.note, goal.createdAt, goal.updatedAt,
      );
      return mapBodyGoal(findBodyGoal.get(goal.userId, goal.subjectId));
    },
    findBodyGoal(userId, subjectId) {
      return mapBodyGoal(findBodyGoal.get(userId, subjectId));
    },
    insertLocalMemory(memory) {
      insertMemory.run(
        memory.memoryId, memory.userId, memory.subjectId, memory.title, memory.content,
        memory.participatesInContext ? 1 : 0, memory.exportMarked ? 1 : 0,
        memory.createdAt, memory.updatedAt,
      );
      return mapLocalMemory(findMemory.get(memory.userId, memory.subjectId, memory.memoryId));
    },
    findLocalMemory(userId, subjectId, memoryId) {
      return mapLocalMemory(findMemory.get(userId, subjectId, memoryId));
    },
    updateLocalMemoryFlags(memory) {
      updateMemoryFlags.run(
        memory.participatesInContext ? 1 : 0, memory.exportMarked ? 1 : 0,
        memory.updatedAt, memory.userId, memory.subjectId, memory.memoryId,
      );
      return mapLocalMemory(findMemory.get(memory.userId, memory.subjectId, memory.memoryId));
    },
    listLocalMemories({ userId, subjectId, participatesInContext, exportMarked, limit }) {
      return connection.prepare(`
        SELECT * FROM local_memories
        WHERE user_id = ? AND subject_id = ?
          AND (? IS NULL OR participates_in_context = ?)
          AND (? IS NULL OR export_marked = ?)
        ORDER BY updated_at DESC, memory_id DESC LIMIT ?
      `).all(
        userId, subjectId,
        participatesInContext === null ? null : Number(participatesInContext),
        participatesInContext === null ? null : Number(participatesInContext),
        exportMarked === null ? null : Number(exportMarked),
        exportMarked === null ? null : Number(exportMarked),
        limit,
      ).map(mapLocalMemory);
    },
  };
}
