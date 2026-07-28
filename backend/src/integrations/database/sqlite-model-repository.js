import { ConflictError } from '../../core/errors.js';

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteModelRepository(connection) {
  const findCapabilitiesStatement = connection.prepare(`
    SELECT capability
    FROM model_capabilities
    WHERE model_id = ?
    ORDER BY CASE capability
      WHEN 'chat' THEN 1
      WHEN 'long_text' THEN 2
      WHEN 'vision' THEN 3
      WHEN 'image' THEN 4
      WHEN 'video' THEN 5
      WHEN 'audio' THEN 6
      WHEN 'search' THEN 7
      WHEN 'embedding' THEN 8
    END
  `);
  const selection = `
    SELECT
      models.model_id,
      models.owner_user_id,
      models.provider_id,
      models.model_name,
      models.model_type,
      models.cost_description,
      models.test_status,
      models.created_at,
      api_providers.display_name AS provider_display_name,
      api_providers.provider_type,
      api_providers.base_url AS provider_base_url,
      api_providers.interface_format AS provider_interface_format,
      api_providers.status AS provider_status,
      api_providers.test_status AS provider_test_status
    FROM models
    INNER JOIN api_providers
      ON api_providers.owner_user_id = models.owner_user_id
      AND api_providers.api_provider_id = models.provider_id
  `;
  const insertModelStatement = connection.prepare(`
    INSERT INTO models (
      model_id,
      owner_user_id,
      provider_id,
      model_name,
      model_type,
      cost_description,
      test_status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCapabilityStatement = connection.prepare(`
    INSERT INTO model_capabilities (model_id, capability)
    VALUES (?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    ${selection}
    WHERE models.owner_user_id = ? AND models.model_id = ?
  `);

  function mapModel(row) {
    if (!row) {
      return null;
    }

    return {
      modelId: row.model_id,
      providerId: row.provider_id,
      modelName: row.model_name,
      modelType: row.model_type,
      costDescription: row.cost_description,
      testStatus: row.test_status,
      capabilities: findCapabilitiesStatement.all(row.model_id).map((item) => item.capability),
      createdAt: row.created_at,
      provider: {
        providerId: row.provider_id,
        displayName: row.provider_display_name,
        providerType: row.provider_type,
        baseUrl: row.provider_base_url,
        interfaceFormat: row.provider_interface_format,
        status: row.provider_status,
        testStatus: row.provider_test_status,
      },
    };
  }

  return {
    insert(model) {
      connection.exec('BEGIN IMMEDIATE;');

      try {
        insertModelStatement.run(
          model.modelId,
          model.ownerUserId,
          model.providerId,
          model.modelName,
          model.modelType,
          model.costDescription,
          model.testStatus,
          model.createdAt,
        );

        for (const capability of model.capabilities) {
          insertCapabilityStatement.run(model.modelId, capability);
        }

        connection.exec('COMMIT;');
      } catch (error) {
        connection.exec('ROLLBACK;');

        if (isConstraintError(error)) {
          throw new ConflictError('Model could not be created for this provider.');
        }

        throw error;
      }

      return mapModel(findByIdStatement.get(model.ownerUserId, model.modelId));
    },
    findById(ownerUserId, modelId) {
      return mapModel(findByIdStatement.get(ownerUserId, modelId));
    },
    findByCapability({ ownerUserId, capability, onlyEnabledProviders }) {
      const enabledCondition = onlyEnabledProviders
        ? "AND api_providers.status = 'enabled'"
        : '';
      const statement = connection.prepare(`
        ${selection}
        INNER JOIN model_capabilities
          ON model_capabilities.model_id = models.model_id
        WHERE models.owner_user_id = ?
          AND model_capabilities.capability = ?
          ${enabledCondition}
        ORDER BY
          api_providers.created_at,
          api_providers.api_provider_id,
          models.created_at,
          models.model_id
      `);

      return statement.all(ownerUserId, capability).map(mapModel);
    },
  };
}
