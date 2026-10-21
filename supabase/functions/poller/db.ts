// The handler's Db over supabase-js, using a service-role client (it bypasses
// RLS; anon and authenticated have no access to these tables).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BudgetRow } from './gate.ts'
import type { Db } from './handler.ts'

function check<T>(what: string, res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data
}

export function supabaseDb(client: SupabaseClient): Db {
  return {
    async startRun(source) {
      const data = check('startRun', await client.from('ingest_runs').insert({ source }).select('id').single())
      return (data as { id: number }).id
    },

    async finishRun(id, fields) {
      check('finishRun', await client.from('ingest_runs').update(fields).eq('id', id))
    },

    async readBudget(source) {
      return check('readBudget', await client.from('poll_budget').select('*').eq('source', source).single()) as BudgetRow
    },

    async claimBudget(source, expectedVersion, next) {
      const data = check(
        'claimBudget',
        await client.from('poll_budget').update(next).eq('source', source).eq('version', expectedVersion).select('source'),
      )
      return (data as unknown[]).length === 1
    },

    async recordObservations(rows) {
      return check('recordObservations', await client.rpc('record_vehicle_observations', { p_rows: rows })) as number
    },

    async recordWeather(rows) {
      return check('recordWeather', await client.rpc('record_weather_observations', { p_rows: rows })) as number
    },

    async pollerSecret() {
      const data = check('pollerSecret', await client.rpc('poller_secret'))
      return typeof data === 'string' ? data : null
    },
  }
}
