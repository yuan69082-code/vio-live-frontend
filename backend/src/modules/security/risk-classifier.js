import { createHash } from 'node:crypto';

import { getSensitiveDataClassification } from '../sensitive-data/sensitive-data-types.js';
import { highestRiskLevel } from './security-types.js';

const operationRisk = Object.freeze({
  general_access: 'low',
  permission_change: 'high',
  api_configuration_change: 'high',
  privacy_access_request: 'high',
  payment_operation: 'critical',
  device_control: 'critical',
  sensitive_data_access: 'high',
  data_deletion: 'high',
});

const actionRisk = Object.freeze({
  read: 'low',
  write: 'medium',
  execute: 'medium',
  control: 'high',
  connect: 'medium',
  export: 'medium',
  delete: 'high',
  manage: 'medium',
});

function resourceRisk(resourceType, action) {
  if (resourceType === 'memory') {
    return 'medium';
  }

  if (resourceType === 'private_domain') {
    return 'high';
  }

  if (resourceType === 'life_data') {
    return 'high';
  }

  if (resourceType === 'proactive_interaction') {
    return action === 'execute' ? 'medium' : 'low';
  }

  if (resourceType === 'data_export') {
    return 'high';
  }

  if (resourceType === 'device' && action === 'control') {
    return 'critical';
  }

  if (resourceType === 'device' || resourceType === 'api') {
    return 'high';
  }

  if (['tool', 'mcp', 'skill'].includes(resourceType) && action === 'execute') {
    return 'medium';
  }

  return 'low';
}

export function classifySecurityRisk({
  operationType,
  resourceType,
  action,
  sensitiveDataCategories,
  minimumRiskLevel = 'low',
}) {
  const reasons = new Set();
  const levels = [
    operationRisk[operationType],
    actionRisk[action],
    resourceRisk(resourceType, action),
    minimumRiskLevel,
  ];

  if (operationRisk[operationType] !== 'low') {
    reasons.add(`operation:${operationType}`);
  }

  if (actionRisk[action] !== 'low') {
    reasons.add(`action:${action}`);
  }

  if (resourceRisk(resourceType, action) !== 'low') {
    reasons.add(`resource:${resourceType}`);
  }

  if (minimumRiskLevel !== 'low') {
    reasons.add(`minimum_risk:${minimumRiskLevel}`);
  }

  for (const category of sensitiveDataCategories) {
    const classification = getSensitiveDataClassification(category);
    levels.push(classification.riskLevel);
    reasons.add(`sensitive_data:${category}`);
  }

  const level = highestRiskLevel(...levels);

  return {
    level,
    sensitiveOperation: level === 'high' || level === 'critical',
    reasons: [...reasons],
    policyVersion: 'security-policy-v1',
    classificationSource: 'platform_rules_with_request_hints',
  };
}

export function createSecurityPolicyFingerprint({
  operationType,
  resourceType,
  resourceId,
  action,
  sensitiveDataCategories,
  risk,
  confirmationMode,
  securityPolicy,
}) {
  const canonicalPolicy = JSON.stringify({
    policyVersion: risk.policyVersion,
    operationType,
    resourceType,
    resourceId,
    action,
    sensitiveDataCategories: [...sensitiveDataCategories].sort(),
    riskLevel: risk.level,
    riskReasons: [...risk.reasons].sort(),
    confirmationMode,
    securityPolicy: securityPolicy ? {
      policyId: securityPolicy.policy?.policyId ?? null,
      policyUpdatedAt: securityPolicy.policy?.updatedAt ?? null,
      rule: securityPolicy.policy?.rule ?? null,
      decision: securityPolicy.decision,
      reason: securityPolicy.reason,
      preferenceUpdatedAt: securityPolicy.preferences.updatedAt,
      securitySessionId: securityPolicy.securitySessionId,
    } : null,
  });

  return createHash('sha256').update(canonicalPolicy).digest('hex');
}
