export const topLevelDomains = [
  '机器人学',
  '人工智能与机器学习',
  '计算机科学与软件工程',
  '数学与控制',
  '电子与通信',
  '机械、航空航天与能源工程',
  '物理、化学与材料科学',
  '生命科学、医学与生物医学工程',
] as const;

export type TopLevelDomain = (typeof topLevelDomains)[number];

export const topLevelDomainIds: Record<TopLevelDomain, string> = {
  机器人学: 'domain-robotics',
  人工智能与机器学习: 'domain-ai-ml',
  计算机科学与软件工程: 'domain-cs-se',
  数学与控制: 'domain-math-control',
  电子与通信: 'domain-electronics-comms',
  '机械、航空航天与能源工程': 'domain-aerospace-mechanics',
  '物理、化学与材料科学': 'domain-physical-materials',
  '生命科学、医学与生物医学工程': 'domain-life-biomedical',
};

export const sourceLanguageOptions = [
  { id: 'auto', label: '自动检测' },
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'ru', label: 'Русский' },
] as const;

export const targetLanguageOptions = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
] as const;

export type SourceLanguageId = (typeof sourceLanguageOptions)[number]['id'];
export type TargetLanguageId = (typeof targetLanguageOptions)[number]['id'];

export const technicalTagSuggestions: Record<TopLevelDomain, readonly string[]> = {
  机器人学: ['ROS 2', '机械臂', '移动机器人', 'SLAM', '无人机 / PX4', '感知与规划'],
  人工智能与机器学习: [
    '深度学习',
    'Transformer',
    '强化学习',
    '计算机视觉',
    '自然语言处理',
    '多模态',
  ],
  计算机科学与软件工程: ['Linux', '编程语言', '编译器', '数据库', 'Kubernetes', '工具链'],
  数学与控制: ['线性代数', '概率统计', '优化', '数值方法', '控制理论', '信号处理'],
  电子与通信: ['嵌入式系统', 'CUDA', '传感器', '通信', '信号', '电子电路'],
  '机械、航空航天与能源工程': [
    '飞行控制',
    '空气动力学',
    '结构力学',
    '振动力学',
    '导航制导',
    '能源系统',
  ],
  '物理、化学与材料科学': ['量子物理', '凝聚态', '化学', '材料科学', '热力学', '计算物理'],
  '生命科学、医学与生物医学工程': [
    '生物信息学',
    '医学影像',
    '神经科学',
    '生物医学工程',
    '分子生物学',
  ],
};

export type TranslationMode = 'replace' | 'below' | 'bilingual';
export type ThinkingMode = 'enabled' | 'disabled';
export type ReasoningEffort = 'high' | 'max';
export type KnowledgeMode = 'hybrid' | 'page_only' | 'general';
export type ModelId = string;

export interface TranslationPreferences {
  sourceLanguage: SourceLanguageId;
  targetLanguage: TargetLanguageId;
  mode: TranslationMode;
  primaryDomain: TopLevelDomain | null;
  tags: string[];
  modelProfileId: string;
}

export type TranslationPreferencePatch = Partial<TranslationPreferences>;

export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'offline';
export type PageState =
  | 'ready'
  | 'translating'
  | 'paused'
  | 'translated'
  | 'untranslatable'
  | 'pdf'
  | 'loading'
  | 'error';

export interface PopupSnapshot extends TranslationPreferences {
  connection: ConnectionState;
  page: PageState;
  completedSegments: number;
  totalSegments: number;
  translationBatch?: number;
  hasMoreBatches?: boolean;
  scanDiagnostics?: PopupScanDiagnostics;
  message?: string;
}

export interface PopupScanDiagnostics {
  discoveredVisible: number;
  eligible: number;
  protected: number;
  ignored: number;
  queued: number;
  completed: number;
  failed: number;
  stale: number;
  overBudget: number;
  unsupported: number;
  cancelled: number;
  notScanned: number;
}

export interface ModelProfile {
  id: string;
  label: string;
  model: ModelId;
  thinking: ThinkingMode;
  reasoningEffort?: ReasoningEffort;
  description: string;
}

export const defaultModelProfiles: readonly ModelProfile[] = [
  {
    id: 'whole-page',
    label: '快速翻译',
    model: 'deepseek-v4-flash',
    thinking: 'disabled',
    description: '整页阅读，关闭思考',
  },
  {
    id: 'precise',
    label: '精确翻译',
    model: 'deepseek-v4-pro',
    thinking: 'disabled',
    description: '选区精确翻译',
  },
  {
    id: 'explain',
    label: '深度解释',
    model: 'deepseek-v4-pro',
    thinking: 'enabled',
    reasoningEffort: 'high',
    description: '上下文解释，High',
  },
  {
    id: 'deep-follow-up',
    label: '深度追问',
    model: 'deepseek-v4-pro',
    thinking: 'enabled',
    reasoningEffort: 'max',
    description: '复杂追问，Max',
  },
] as const;

export const defaultTranslationPreferences: TranslationPreferences = {
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  mode: 'below',
  primaryDomain: null,
  tags: [],
  modelProfileId: 'whole-page',
};

export function languageLabel(languageId: string): string {
  return (
    [...sourceLanguageOptions, ...targetLanguageOptions].find(({ id }) => id === languageId)
      ?.label ?? languageId
  );
}

export function domainIdForName(domain: TopLevelDomain | null): string | undefined {
  return domain === null ? undefined : topLevelDomainIds[domain];
}

export function domainNameForId(domainId: string | null | undefined): TopLevelDomain | null {
  if (domainId === null || domainId === undefined) return null;
  return (
    (Object.entries(topLevelDomainIds).find(([, id]) => id === domainId)?.[0] as
      TopLevelDomain | undefined) ?? null
  );
}
