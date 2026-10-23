// Names the tests that failed and then passed on a retry (CI only:
// vite.config.ts), so an intermittent failure is caught by name rather than
// lost in a rerun: in the log, and as a warning on the run (the
// github-actions reporter lists them in the job's summary).

import type { Reporter, TestCase } from 'vitest/node'

export default class FlakyReporter implements Reporter {
  private readonly flaky: string[] = []

  onTestCaseResult(test: TestCase) {
    const d = test.diagnostic()
    if (d?.flaky) this.flaky.push(`${test.module.relativeModuleId} > ${test.fullName} (passed after ${d.retryCount} ${d.retryCount === 1 ? 'retry' : 'retries'})`)
  }

  onTestRunEnd() {
    if (!this.flaky.length) return
    console.log(`\nFlaky tests:\n${this.flaky.map((f) => `  ${f}`).join('\n')}`)
    if (process.env.GITHUB_ACTIONS) for (const f of this.flaky) console.log(`::warning title=Flaky test::${f}`)
  }
}
