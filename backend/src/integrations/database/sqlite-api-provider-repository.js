function mapProvider(row) {
  if (!row) {
    return null;
  }

  return {
    providerId: row.api_provider_id,
    ownerUserId: row.owner_user_id,
    displayName: row.display_name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    interfaceFormat: row.interface_format,
    status: row.status,
    testStatus: row.test_status,
    apiKeySecretRef: row.api_key_secret_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSqliteApiProviderRepository(connection) {
  const selection = `
    SELECT
      api_provider_id,
      owner_user_id,
      display_name,
      provider_type,
      base_url,
      interface_format,
      status,
      test_status,
      api_key_secret_ref,
      created_at,
      updated_at
    FROM api_providers
  `;
  const insertStatement = connection.prepare(`
    INSERT INTO api_providers (
      api_provider_id,
      owner_user_id,
      display_name,
      provider_type,
      base_url,
      interface_format,
      status,
      test_status,
      api_key_secret_ref,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    ${selection}
    WHERE owner_user_id = ? AND api_provider_id = ?
  `);
  const findManyByUserStatement = connection.prepare(`
    ${selection}
    WHERE owner_user_id = ?
    ORDER BY created_at, api_provider_id
  `);
  const updateStatusStatement = connection.prepare(`
    UPDATE api_providers
    SET status = ?, updated_at = ?
    WHERE owner_user_id = ? AND api_provider_id = ?
  `);

  return {
    insert(provider) {
      insertStatement.run(
        provider.providerId,
        provider.ownerUserId,
        provider.displayName,
        provider.providerType,
        provider.baseUrl,
        provider.interfaceFormat,
        provider.status,
        provider.testStatus,
        provider.apiKeySecretRef,
        provider.createdAt,
        provider.updatedAt,
      );

      return provider;
    },
    findById(ownerUserId, providerId) {
      return mapProvider(findByIdStatement.get(ownerUserId, providerId));
    },
    findManyByUser(ownerUserId) {
      return findManyByUserStatement.all(ownerUserId).map(mapProvider);
    },
    updateStatus(ownerUserId, providerId, status, updatedAt) {
      const result = updateStatusStatement.run(status, updatedAt, ownerUserId, providerId);

      if (result.changes === 0) {
        return null;
      }

      return mapProvider(findByIdStatement.get(ownerUserId, providerId));
    },
  };
}
