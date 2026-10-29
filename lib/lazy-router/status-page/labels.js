// Chinese display labels of the status page (shared by server and browser).

export const LABELS = Object.freeze({
  routes: {
    default: "主会话", task: "子任务", weak: "弱档", vision: "视觉",
    "lazy/default": "Lazy · default",
    "lazy/task": "Lazy · task",
    "lazy/pro": "Lazy · pro",
    "lazy/batch-blind": "Lazy · batch-blind",
    "lazy/weak": "Lazy · weak",
    "rush/default": "Rush · default",
    "rush/task": "Rush · task",
    "rush/vision": "Rush · vision",
    "weak/default": "Weak · coordinator",
    "weak/task": "Weak · workers",
  },
  periods: { peak: "高峰", offPeak: "空闲" },
  dayKinds: { workday: "工作日", weekend: "周末", holiday: "节假日", makeupWorkday: "调休补班" },
  calendars: { official: "官方", estimate: "估算", uncovered: "未覆盖" },
  efforts: { capped: "≤ medium", none: "none", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
  health: { alive: "可用", cooling: "冷却中", unknown: "未知" },
});
