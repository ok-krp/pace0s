/* eslint-disable */
// @ts-nocheck
// noinspection JSUnusedGlobalSymbols
// This file is generated from Pace's file-based TanStack routes.

import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as AiActivityRouteImport } from './routes/ai-activity'
import { Route as AssistantRouteImport } from './routes/assistant'
import { Route as BodyRouteImport } from './routes/body'
import { Route as CalendarRouteImport } from './routes/calendar'
import { Route as DevelopmentRouteImport } from './routes/development'
import { Route as FinanceRouteImport } from './routes/finance'
import { Route as InvestmentsRouteImport } from './routes/investments'
import { Route as LoginRouteImport } from './routes/login'
import { Route as McpRouteImport } from './routes/mcp'
import { Route as NutritionRouteImport } from './routes/nutrition'
import { Route as NotesRouteImport } from './routes/notes'
import { Route as ProfileRouteImport } from './routes/profile'
import { Route as RecallsRouteImport } from './routes/recalls'
import { Route as RecipesRouteImport } from './routes/recipes'
import { Route as RoutineRouteImport } from './routes/routine'
import { Route as ScanRouteImport } from './routes/scan'
import { Route as SettingsRouteImport } from './routes/settings'
import { Route as SleepRouteImport } from './routes/sleep'
import { Route as SportRouteImport } from './routes/sport'
import { Route as WatchRouteImport } from './routes/watch'
import { Route as WaterRouteImport } from './routes/water'
import { Route as WorkRouteImport } from './routes/work'
import { Route as ApiAiChatRouteImport } from './routes/api/ai-chat'
import { Route as ApiPublicHooksRemindersRouteImport } from './routes/api/public/hooks/reminders'
import { Route as OAuthProtectedResourceRouteImport } from './routes/[.well-known]/oauth-protected-resource'
import { Route as McpListToolsRouteImport } from './routes/[.mcp]/list-tools'
import { Route as McpInvokeToolRouteImport } from './routes/[.mcp]/invoke-tool/$tool'
import { Route as LovableOAuthConsentRouteImport } from './routes/[.]lovable.oauth.consent'
import { Route as AiConversationRouteImport } from './routes/ai.$agentType.$conversationId'

const rootRoute = rootRouteImport
const child = (route: any, id: string, path: string) =>
  route.update({ id, path, getParentRoute: () => rootRoute } as any)

const IndexRoute = child(IndexRouteImport, '/', '/')
const AiActivityRoute = child(AiActivityRouteImport, '/ai-activity', '/ai-activity')
const AssistantRoute = child(AssistantRouteImport, '/assistant', '/assistant')
const BodyRoute = child(BodyRouteImport, '/body', '/body')
const CalendarRoute = child(CalendarRouteImport, '/calendar', '/calendar')
const DevelopmentRoute = child(DevelopmentRouteImport, '/development', '/development')
const FinanceRoute = child(FinanceRouteImport, '/finance', '/finance')
const InvestmentsRoute = child(InvestmentsRouteImport, '/investments', '/investments')
const LoginRoute = child(LoginRouteImport, '/login', '/login')
const McpRoute = child(McpRouteImport, '/mcp', '/mcp')
const NutritionRoute = child(NutritionRouteImport, '/nutrition', '/nutrition')
const NotesRoute = child(NotesRouteImport, '/notes', '/notes')
const ProfileRoute = child(ProfileRouteImport, '/profile', '/profile')
const RecallsRoute = child(RecallsRouteImport, '/recalls', '/recalls')
const RecipesRoute = child(RecipesRouteImport, '/recipes', '/recipes')
const RoutineRoute = child(RoutineRouteImport, '/routine', '/routine')
const ScanRoute = child(ScanRouteImport, '/scan', '/scan')
const SettingsRoute = child(SettingsRouteImport, '/settings', '/settings')
const SleepRoute = child(SleepRouteImport, '/sleep', '/sleep')
const SportRoute = child(SportRouteImport, '/sport', '/sport')
const WatchRoute = child(WatchRouteImport, '/watch', '/watch')
const WaterRoute = child(WaterRouteImport, '/water', '/water')
const WorkRoute = child(WorkRouteImport, '/work', '/work')
const ApiAiChatRoute = child(ApiAiChatRouteImport, '/api/ai-chat', '/api/ai-chat')
const ApiPublicHooksRemindersRoute = child(ApiPublicHooksRemindersRouteImport, '/api/public/hooks/reminders', '/api/public/hooks/reminders')
const OAuthProtectedResourceRoute = child(OAuthProtectedResourceRouteImport, '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource')
const McpListToolsRoute = child(McpListToolsRouteImport, '/.mcp/list-tools', '/.mcp/list-tools')
const McpInvokeToolRoute = child(McpInvokeToolRouteImport, '/.mcp/invoke-tool/$tool', '/.mcp/invoke-tool/$tool')
const LovableOAuthConsentRoute = child(LovableOAuthConsentRouteImport, '/.lovable/oauth/consent', '/.lovable/oauth/consent')
const AiConversationRoute = child(AiConversationRouteImport, '/ai/$agentType/$conversationId', '/ai/$agentType/$conversationId')

export const routeTree = rootRoute.addChildren({
  IndexRoute,
  AiActivityRoute,
  AssistantRoute,
  BodyRoute,
  CalendarRoute,
  DevelopmentRoute,
  FinanceRoute,
  InvestmentsRoute,
  LoginRoute,
  McpRoute,
  NutritionRoute,
  NotesRoute,
  ProfileRoute,
  RecallsRoute,
  RecipesRoute,
  RoutineRoute,
  ScanRoute,
  SettingsRoute,
  SleepRoute,
  SportRoute,
  WatchRoute,
  WaterRoute,
  WorkRoute,
  ApiAiChatRoute,
  ApiPublicHooksRemindersRoute,
  OAuthProtectedResourceRoute,
  McpListToolsRoute,
  McpInvokeToolRoute,
  LovableOAuthConsentRoute,
  AiConversationRoute,
} as any)

export { rootRoute }
