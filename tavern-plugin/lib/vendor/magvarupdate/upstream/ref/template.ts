// noinspection JSUnusedLocalSymbols

/**
 * 消息选择过滤器
 * @interface MessageFilter
 * @property {('system' | 'user' | 'assistant' | 'any')} [role='assistant'] - 选取指定角色.
 *      可以是 'system', 'user', 'assistant', or 'any'. 从末尾开始搜索. 如果设置了id则此项会无效.
 * @property {number} [id=undefined] - 选取指定的消息楼层,可以是负数(负数为末尾开始).
 * @property {number} [swipe_id=undefined] - 选取指定消息的切换ID.
 */

/**
 * 设置变量选项
 * @typedef {Object} SetVarOption
 * @property {number} [index=undefined] - 变量的索引,与/setvar的index相同.
 * @property {'global' | 'local' | 'message' | 'cache'} [scope='message'] - 变量类型(作用域),详见下方
 * @property {'nx' | 'xx' | 'n' | 'nxs' | 'xxs'} [flags='n'] - 设置条件,不满足则不设置,详见下方
 * @property {'old' | 'new' | 'fullcache'} [results='fullcache'] - 返回值类型,详见下方
 * @property {MessageFilter} [withMsg=undefined] - 消息过滤器(如果要设置消息变量)
 * @property {boolean} [merge=false] - 是否使用合并来设置(_.merge)变量
 * @property {boolean} [dryRun=false] - 是否允许在准备阶段设置变量
 * @property {boolean} [noCache=false] - 禁用缓存(例如在设置变量后立即读取)
 */

/**
 * 设置变量
 *
 * @param {string} key - 变量名
 * @param {any} value - 变量值
 * @param {SetVarOption} [options={}] - 设置变量选项.
 * @returns 成功根据options.results决定，失败返回undefined
 */
function setvar(key, value, options = {});

/**
 * 获取变量选项
 * @typedef {Object} GetVarOption
 * @property {number} [index=undefined] - 变量的索引,与/getvar的index相同
 * @property {'global' | 'local' | 'message' | 'cache'} [scope='cache'] - 变量类型(作用域),详见下方
 * @property {any} [defaults=undefined] - 默认值(如果变量不存在时返回)
 * @property {MessageFilter} [withMsg=undefined] - 消息选择过滤器
 * @property {boolean} [noCache=false] - 禁用缓存(例如在设置变量后立即读取)
 */

/**
 * 读取变量
 *
 * @param {string} key - 变量名
 * @param {GetVarOption} [options={}] - 获取变量选项
 * @returns {any} - 变量值,找不到返回options.defaults的值
 */
function getvar(key, options = {});

/**
 * 更新变量选项
 * @typedef {Object} GetSetVarOption
 * @property {number} [index] - 变量的索引,与/getvar的index相同
 * @property {unknown} [defaults=0] - 如果变量不存在时使用的默认值
 * @property {'global' | 'local' | 'message' | 'cache'} [inscope='cache'] - 读取的变量类型(作用域),详见下方
 * @property {'global' | 'local' | 'message' | 'cache'} outscope='message'] - 设置的变量类型(作用域),详见下方
 * @property {'nx' | 'xx' | 'n' | 'nxs' | 'xxs'} [flags='n'] - 更新条件,不满足则不更新,详见下方
 * @property {'old' | 'new' | 'fullcache'} [results='fullcache'] - 返回值类型,详见下方
 * @property {MessageFilter} [withMsg=undefined] - 消息过滤器(如果要设置消息变量)
 * @property {boolean} [dryRun=false] - 是否允许在准备阶段更新变量
 * @property {boolean} [noCache=false] - 禁用缓存(例如在设置变量后立即读取)
 */

/**
 * 增加变量的值
 *
 * @param {string} key - 变量名
 * @param {number} [value=1] - 变量值
 * @param {GetSetVarOption} [options={}] - 更新变量选项
 * @returns 根据options.results决定,失败返回undefined.
 */
function incvar(key, value = 1, options = {});

/**
 * 减少变量的值
 *
 * @param {string} key - 变量名
 * @param {number} [value=1] - 变量值
 * @param {GetSetVarOption} [options={}] - 更新变量选项
 * @returns 根据options.results决定,失败返回undefined.
 */
function decvar(key, value = 1, options = {});

/**
 * 执行命令,例如/setvar
 *
 * @param {string} cmd - 命令
 * @returns {Promise<string>} - 命令返回值
 */
async function execute(cmd);

/**
 * 读取世界书条目内容
 *
 * @param {string} worldinfo - 世界书名
 * @param {string | RegExp | number} title - 条目uid/标题
 * @param {Record<string, any>} [data={}] - 传递的数据
 * @returns {Promise<string>} - 世界书条目的内容
 */
async function getwi(worldinfo, title, data = {});

/**
 * 读取角色卡定义
 *
 * @param {string | RegExp} name - 角色卡名字
 * @param {string} [template=DEFAULT_CHAR_DEFINE] - 输出格式
 * @param {Record<string, any>} [data={}] - 传递的数据
 * @returns {Promise<string>} - 角色卡定义的内容
 */
async function getchr(name, template = DEFAULT_CHAR_DEFINE, data = {});

/**
 * 读取预设的提示词内容
 *
 * @param {string | RegExp} name - 提示词的名字
 * @param {Record<string, any>} [data={}] - 传递的数据
 * @returns {Promise<string>} - 预设的提示词的内容
 */
async function getprp(name, data = {});

/**
 * 定义全局变量/函数
 *
 * @param {string} name - 变量/函数名
 * @param {any} value - 变量/函数的内容
 * @note 定义函数时应该使用 this 访问上下文, 例如: this.variables, this.getvar, this.setvar
 */
function define(name, value);
