/* eslint-disable */
// @ts-nocheck
// noinspection JSUnusedGlobalSymbols
// This file is regenerated from the file-based routes. Do not edit manually.

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

const routes = [
  IndexRouteImport,
  AiActivityRouteImport,
  AssistantRouteImport,
  BodyRouteImport,
  CalendarRouteImport,
  DevelopmentRouteImport,
  FinanceRouteImport,
  InvestmentsRouteImport,
  LoginRouteImport,
  McpRouteImport,
  NutritionRouteImport,
  NotesRouteImport,
  ProfileRouteImport,
  RecallsRouteImport,
  RecipesRouteImport,
  RoutineRouteImport,
  ScanRouteImport,
  SettingsRouteImport,
  SleepRouteImport,
  SportRouteImport,
  WatchRouteImport,
  WaterRouteImport,
  WorkRouteImport,
  ApiAiChatRouteImport,
  ApiPublicHooksRemindersRouteImport,
  OAuthProtectedResourceRouteImport,
  McpListToolsRouteImport,
  McpInvokeToolRouteImport,
  LovableOAuthConsentRouteImport,
  AiConversationRouteImport,
]

export const routeTree = rootRoute.addChildren(routes.map((route: any) => route.update({ getParentRoute: () => rootRoute } as any)) as any)

export { rootRoute }
