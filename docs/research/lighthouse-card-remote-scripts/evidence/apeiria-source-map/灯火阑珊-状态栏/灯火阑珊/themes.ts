// ============================================================================
// 踏月寻仙 - 主题配置系统 (Theme Configuration System)
// 版本: 1.0
// ============================================================================

/**
 * 主题配置接口
 */
export interface Theme {
    id: string;
    name: string;
    description: string;
    colors: {
        // 主要背景色
        bgPrimary: string;
        bgSecondary: string;
        // 边框颜色
        border: string;
        borderActive: string;
        // 文字颜色
        textPrimary: string;
        textSecondary: string;
        textAccent: string;
        // 强调色
        accent: string;
        accentGlow: string;
        // 按钮颜色
        buttonBg: string;
        buttonHover: string;
        buttonActive: string;
        // 进度条颜色
        progressBg: string;
        // 头部颜色
        headerBg: string;
        // 标签颜色
        tabBg: string;
        tabActive: string;
        // 底部颜色
        footerBg: string;
    };
    patterns: {
        // 背景图案 (CSS background-image)
        overlay?: string;
        // 装饰图案类名
        decoration?: string;
    };
}

/**
 * CSS 图案生成器
 */
export const patterns = {
    // 祥云图片 - 用于主要装饰
    cloudImage: `url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png)`,

    // 祥云图案（多层叠加）- 用于丰富背景层次
    cloudsMulti: `
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png)
  `,

    // 祥云 + 星辰组合（玄青仙境专属）
    cloudsWithStars: `
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    radial-gradient(circle at 25% 20%, rgba(136, 170, 204, 0.2) 1px, transparent 1px),
    radial-gradient(circle at 75% 35%, rgba(136, 170, 204, 0.15) 1.5px, transparent 1.5px),
    radial-gradient(circle at 35% 75%, rgba(136, 170, 204, 0.12) 1px, transparent 1px),
    radial-gradient(circle at 60% 50%, rgba(160, 184, 208, 0.1) 2px, transparent 2px)
  `,

    // 紫霞流光（紫霞仙踪专属）
    purpleMist: `
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    linear-gradient(135deg,
      transparent 0%,
      rgba(170, 136, 204, 0.08) 25%,
      transparent 50%,
      rgba(192, 160, 208, 0.08) 75%,
      transparent 100%
    ),
    radial-gradient(ellipse at 30% 40%, rgba(170, 136, 204, 0.15) 0%, transparent 40%),
    radial-gradient(ellipse at 70% 60%, rgba(192, 160, 208, 0.12) 0%, transparent 40%)
  `,

    // 碧海波纹（碧海青天专属）
    oceanWaves: `
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    repeating-linear-gradient(
      0deg,
      transparent 0px,
      rgba(136, 204, 221, 0.03) 2px,
      transparent 4px,
      transparent 20px
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0px,
      rgba(136, 204, 221, 0.02) 2px,
      transparent 4px,
      transparent 30px
    ),
    radial-gradient(circle at 50% 80%, rgba(136, 204, 221, 0.1) 0%, transparent 50%)
  `,

    // 金光璀璨（金辉灿烂专属）
    goldenShimmer: `
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    repeating-linear-gradient(
      45deg,
      transparent 0px,
      rgba(204, 170, 136, 0.04) 1px,
      transparent 2px,
      transparent 15px
    ),
    repeating-linear-gradient(
      -45deg,
      transparent 0px,
      rgba(220, 200, 120, 0.03) 1px,
      transparent 2px,
      transparent 15px
    ),
    radial-gradient(ellipse at 50% 30%, rgba(204, 170, 136, 0.12) 0%, transparent 50%)
  `,

    // 竹影摇曳（翠竹清风专属）
    bambooShadow: `
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    url(https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo/古风祥云云朵85.png),
    repeating-linear-gradient(
      90deg,
      transparent 0px,
      rgba(136, 204, 170, 0.05) 1px,
      transparent 2px,
      transparent 40px
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0px,
      rgba(136, 204, 170, 0.03) 1px,
      transparent 3px,
      transparent 60px
    ),
    radial-gradient(ellipse at 20% 60%, rgba(136, 204, 170, 0.1) 0%, transparent 40%),
    radial-gradient(ellipse at 80% 40%, rgba(160, 208, 192, 0.08) 0%, transparent 40%)
  `,

    // 星辰图案
    stars: `
    radial-gradient(circle at 20% 30%, rgba(255, 255, 255, 0.3) 1px, transparent 1px),
    radial-gradient(circle at 80% 60%, rgba(255, 255, 255, 0.25) 1.5px, transparent 1.5px),
    radial-gradient(circle at 40% 80%, rgba(255, 255, 255, 0.2) 1px, transparent 1px),
    radial-gradient(circle at 60% 20%, rgba(255, 255, 255, 0.15) 2px, transparent 2px)
  `,

    // 纹理图案
    texture: `
    repeating-linear-gradient(
      45deg,
      transparent,
      transparent 10px,
      rgba(255, 255, 255, 0.03) 10px,
      rgba(255, 255, 255, 0.03) 20px
    )
  `,

    // 山水图案
    landscape: `
    linear-gradient(180deg,
      transparent 0%,
      rgba(255, 255, 255, 0.02) 30%,
      rgba(255, 255, 255, 0.05) 50%,
      rgba(255, 255, 255, 0.02) 70%,
      transparent 100%
    )
  `,

    // 莲花图案
    lotus: `
    radial-gradient(ellipse 120px 80px at 50% 50%, rgba(255, 255, 255, 0.08) 0%, transparent 50%)
  `,
};

/**
 * 预设主题列表
 */
export const themes: Theme[] = [
    // 默认主题 - 玄青
    {
        id: 'default',
        name: '玄青仙境',
        description: '深邃玄青，如夜空星辰',
        colors: {
            bgPrimary: 'linear-gradient(180deg, rgba(49, 66, 117, 0.95) 0%, rgba(15, 20, 35, 0.98) 100%)',
            bgSecondary: 'rgba(30, 40, 60, 0.5)',
            border: 'rgba(100, 150, 200, 0.3)',
            borderActive: 'rgba(100, 150, 200, 0.6)',
            textPrimary: '#e0e8f0',
            textSecondary: '#8090a0',
            textAccent: '#a0b8d0',
            accent: '#88aacc',
            accentGlow: 'rgba(100, 150, 255, 0.3)',
            buttonBg: 'rgba(100, 150, 200, 0.2)',
            buttonHover: 'rgba(100, 150, 200, 0.3)',
            buttonActive: 'linear-gradient(135deg, rgba(80, 120, 180, 0.3) 0%, rgba(100, 80, 160, 0.3) 100%)',
            progressBg: 'rgba(50, 60, 80, 0.8)',
            headerBg: 'linear-gradient(90deg, rgba(60, 80, 120, 0.4) 0%, rgba(80, 60, 100, 0.4) 100%)',
            tabBg: 'rgba(30, 40, 60, 0.5)',
            tabActive: 'linear-gradient(135deg, rgba(80, 120, 180, 0.3) 0%, rgba(100, 80, 160, 0.3) 100%)',
            footerBg: 'rgba(20, 30, 45, 0.8)',
        },
        patterns: {
            overlay: patterns.cloudsMulti,
        },
    },

    // 紫霞主题
    {
        id: 'purple',
        name: '紫霞仙踪',
        description: '紫气东来，霞光万道',
        colors: {
            bgPrimary: 'linear-gradient(180deg, rgba(80, 40, 100, 0.95) 0%, rgba(30, 15, 40, 0.98) 100%)',
            bgSecondary: 'rgba(50, 30, 70, 0.5)',
            border: 'rgba(150, 100, 200, 0.3)',
            borderActive: 'rgba(180, 120, 220, 0.6)',
            textPrimary: '#f0e0f8',
            textSecondary: '#a080b0',
            textAccent: '#c0a0d0',
            accent: '#aa88cc',
            accentGlow: 'rgba(150, 100, 255, 0.4)',
            buttonBg: 'rgba(150, 100, 200, 0.2)',
            buttonHover: 'rgba(150, 100, 200, 0.3)',
            buttonActive: 'linear-gradient(135deg, rgba(120, 80, 160, 0.3) 0%, rgba(140, 60, 180, 0.3) 100%)',
            progressBg: 'rgba(60, 40, 80, 0.8)',
            headerBg: 'linear-gradient(90deg, rgba(80, 50, 100, 0.4) 0%, rgba(100, 40, 120, 0.4) 100%)',
            tabBg: 'rgba(50, 30, 70, 0.5)',
            tabActive: 'linear-gradient(135deg, rgba(120, 80, 160, 0.3) 0%, rgba(140, 60, 180, 0.3) 100%)',
            footerBg: 'rgba(30, 20, 50, 0.8)',
        },
        patterns: {
            overlay: patterns.cloudsMulti,
        },
    },

    // 赤炎主题
    {
        id: 'red',
        name: '赤炎烈焰',
        description: '烈火焚天，赤炎千里',
        colors: {
            bgPrimary: 'linear-gradient(180deg, rgba(100, 40, 40, 0.95) 0%, rgba(40, 15, 15, 0.98) 100%)',
            bgSecondary: 'rgba(70, 30, 30, 0.5)',
            border: 'rgba(200, 100, 100, 0.3)',
            borderActive: 'rgba(220, 120, 120, 0.6)',
            textPrimary: '#f8e0e0',
            textSecondary: '#b08080',
            textAccent: '#d0a0a0',
            accent: '#cc8888',
            accentGlow: 'rgba(255, 100, 100, 0.4)',
            buttonBg: 'rgba(200, 100, 100, 0.2)',
            buttonHover: 'rgba(200, 100, 100, 0.3)',
            buttonActive: 'linear-gradient(135deg, rgba(160, 80, 80, 0.3) 0%, rgba(180, 60, 60, 0.3) 100%)',
            progressBg: 'rgba(80, 40, 40, 0.8)',
            headerBg: 'linear-gradient(90deg, rgba(100, 50, 50, 0.4) 0%, rgba(120, 40, 40, 0.4) 100%)',
            tabBg: 'rgba(70, 30, 30, 0.5)',
            tabActive: 'linear-gradient(135deg, rgba(160, 80, 80, 0.3) 0%, rgba(180, 60, 60, 0.3) 100%)',
            footerBg: 'rgba(50, 20, 20, 0.8)',
        },
        patterns: {
            overlay: patterns.cloudsMulti,
        },
    },

    // 碧海主题
    {
        id: 'cyan',
        name: '碧海青天',
        description: '碧波荡漾，海天一色',
        colors: {
            bgPrimary: 'linear-gradient(180deg, rgba(40, 80, 100, 0.95) 0%, rgba(15, 30, 40, 0.98) 100%)',
            bgSecondary: 'rgba(30, 60, 70, 0.5)',
            border: 'rgba(100, 180, 200, 0.3)',
            borderActive: 'rgba(120, 200, 220, 0.6)',
            textPrimary: '#e0f0f8',
            textSecondary: '#80a0b0',
            textAccent: '#a0c0d0',
            accent: '#88ccdd',
            accentGlow: 'rgba(100, 200, 255, 0.4)',
            buttonBg: 'rgba(100, 180, 200, 0.2)',
            buttonHover: 'rgba(100, 180, 200, 0.3)',
            buttonActive: 'linear-gradient(135deg, rgba(80, 140, 160, 0.3) 0%, rgba(60, 160, 180, 0.3) 100%)',
            progressBg: 'rgba(40, 60, 80, 0.8)',
            headerBg: 'linear-gradient(90deg, rgba(50, 80, 100, 0.4) 0%, rgba(40, 100, 120, 0.4) 100%)',
            tabBg: 'rgba(30, 60, 70, 0.5)',
            tabActive: 'linear-gradient(135deg, rgba(80, 140, 160, 0.3) 0%, rgba(60, 160, 180, 0.3) 100%)',
            footerBg: 'rgba(20, 40, 50, 0.8)',
        },
        patterns: {
            overlay: patterns.cloudsMulti,
        },
    },

    // 金辉主题
    {
        id: 'gold',
        name: '金辉灿烂',
        description: '金光璀璨，辉映九天',
        colors: {
            bgPrimary: 'linear-gradient(180deg, rgba(80, 70, 40, 0.95) 0%, rgba(30, 25, 15, 0.98) 100%)',
            bgSecondary: 'rgba(60, 50, 30, 0.5)',
            border: 'rgba(200, 180, 100, 0.3)',
            borderActive: 'rgba(220, 200, 120, 0.6)',
            textPrimary: '#f8f0e0',
            textSecondary: '#b0a080',
            textAccent: '#d0c0a0',
            accent: '#ccaa88',
            accentGlow: 'rgba(255, 200, 100, 0.4)',
            buttonBg: 'rgba(200, 180, 100, 0.2)',
            buttonHover: 'rgba(200, 180, 100, 0.3)',
            buttonActive: 'linear-gradient(135deg, rgba(160, 140, 80, 0.3) 0%, rgba(180, 160, 60, 0.3) 100%)',
            progressBg: 'rgba(60, 50, 40, 0.8)',
            headerBg: 'linear-gradient(90deg, rgba(80, 70, 50, 0.4) 0%, rgba(100, 80, 40, 0.4) 100%)',
            tabBg: 'rgba(60, 50, 30, 0.5)',
            tabActive: 'linear-gradient(135deg, rgba(160, 140, 80, 0.3) 0%, rgba(180, 160, 60, 0.3) 100%)',
            footerBg: 'rgba(40, 35, 20, 0.8)',
        },
        patterns: {
            overlay: patterns.cloudsMulti,
        },
    },

    // 翠竹主题
    {
        id: 'green',
        name: '翠竹清风',
        description: '竹影婆娑，清风徐来',
        colors: {
            bgPrimary: 'linear-gradient(180deg, rgba(40, 80, 60, 0.95) 0%, rgba(15, 30, 25, 0.98) 100%)',
            bgSecondary: 'rgba(30, 60, 50, 0.5)',
            border: 'rgba(100, 180, 150, 0.3)',
            borderActive: 'rgba(120, 200, 170, 0.6)',
            textPrimary: '#e0f8f0',
            textSecondary: '#80b0a0',
            textAccent: '#a0d0c0',
            accent: '#88ccaa',
            accentGlow: 'rgba(100, 255, 200, 0.4)',
            buttonBg: 'rgba(100, 180, 150, 0.2)',
            buttonHover: 'rgba(100, 180, 150, 0.3)',
            buttonActive: 'linear-gradient(135deg, rgba(80, 140, 120, 0.3) 0%, rgba(60, 160, 140, 0.3) 100%)',
            progressBg: 'rgba(40, 60, 50, 0.8)',
            headerBg: 'linear-gradient(90deg, rgba(50, 80, 70, 0.4) 0%, rgba(40, 100, 80, 0.4) 100%)',
            tabBg: 'rgba(30, 60, 50, 0.5)',
            tabActive: 'linear-gradient(135deg, rgba(80, 140, 120, 0.3) 0%, rgba(60, 160, 140, 0.3) 100%)',
            footerBg: 'rgba(20, 40, 35, 0.8)',
        },
        patterns: {
            overlay: patterns.cloudsMulti,
        },
    },
];

/**
 * 根据ID获取主题
 */
export function getThemeById(id: string): Theme | undefined {
    return themes.find(t => t.id === id);
}

/**
 * 获取默认主题
 */
export function getDefaultTheme(): Theme {
    return themes.find(t => t.id === 'red') || themes[0];
}