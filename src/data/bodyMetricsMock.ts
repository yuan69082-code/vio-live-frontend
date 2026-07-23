export type BodyMeasurementRecord = {
  id: string
  date: string
  dateLabel: string
  weight: number
  waist: number
  chest: number
  hips: number
  note: string
}

export const bodyMetricsProfile = {
  targetWeight: 58,
  height: 168,
}

export const bodyMetricsMockRecords: BodyMeasurementRecord[] = [
  { id: 'body-1', date: '2026-06-10', dateLabel: '6月10日', weight: 63.4, waist: 71, chest: 89.5, hips: 94.5, note: '开始记录，保持原有生活节奏。' },
  { id: 'body-2', date: '2026-06-17', dateLabel: '6月17日', weight: 63, waist: 70.8, chest: 89.2, hips: 94.2, note: '本周规律记录。' },
  { id: 'body-3', date: '2026-06-24', dateLabel: '6月24日', weight: 62.7, waist: 70.2, chest: 89, hips: 93.8, note: '记录时间改到早晨。' },
  { id: 'body-4', date: '2026-07-01', dateLabel: '7月1日', weight: 62.9, waist: 70.4, chest: 89, hips: 93.9, note: '旅行后补记。' },
  { id: 'body-5', date: '2026-07-08', dateLabel: '7月8日', weight: 62.3, waist: 69.5, chest: 88.6, hips: 93.2, note: '继续观察，不做单次判断。' },
  { id: 'body-6', date: '2026-07-15', dateLabel: '7月15日', weight: 62, waist: 69, chest: 88.3, hips: 92.7, note: '按同一时间段记录。' },
  { id: 'body-7', date: '2026-07-22', dateLabel: '7月22日', weight: 61.8, waist: 68.6, chest: 88, hips: 92.3, note: '最近睡眠节奏较稳定。' },
]
