/**
 * 本地 React 类型垫片。
 *
 * 宿主在页面里提供 React（打包时列在 neverBundle 里），插件目录下没有
 * @types/react 可用，所以这里只声明本插件真正用到的三个钩子——够 tsc
 * 独立校验，又不需要为一个纯 DOM 插件拖进整套 React 类型。
 * 哪天目录里装了 @types/react，删掉这个文件即可。
 */
declare module 'react' {
  /** 值随依赖变化时重算。 */
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T
  /** 渲染后运行副作用，返回值作为清理函数。 */
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  /** 跨渲染保持的可变引用。 */
  export function useRef<T>(initial: T): { current: T }
}
