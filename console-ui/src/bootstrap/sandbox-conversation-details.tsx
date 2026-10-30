import { cloneElement, isValidElement, type ReactNode } from 'react'
import { SandboxConversationDetails, type SandboxConversationContext } from '../pages/SandboxConversationDetails'

interface SandboxPageProps {
  readonly renderConversationDetails?: (context: SandboxConversationContext) => ReactNode
}

/** Optional props let old pages and old shells retain their existing standalone links. */
export function withSandboxConversationDetails<T extends { path?: string; element: ReactNode }>(route: T): T {
  if (route.path !== '/sandbox' || !isValidElement<SandboxPageProps>(route.element)) return route
  const component = route.element.type
  if (typeof component !== 'function' && (typeof component !== 'object' || component === null)) return route
  if (route.element.props.renderConversationDetails !== undefined) return route
  return { ...route, element: cloneElement(route.element, {
    renderConversationDetails: context => <SandboxConversationDetails {...context} />,
  }) }
}
