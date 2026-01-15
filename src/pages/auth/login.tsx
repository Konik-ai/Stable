import { createSignal } from 'solid-js'
import { getGitHubAuthUrl } from '~/api/auth'

import Button from '~/components/material/Button'

export default function Login() {
  const [agreed, setAgreed] = createSignal(false)
  const handleSignIn = () => {
    if (!agreed()) return
    window.location.href = getGitHubAuthUrl()
  }

  return (
    <div class="relative flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div class="flex max-w-sm flex-col items-center gap-8">
        <img src="/images/logo-connect-light.svg" alt="Konik Stable" width={96} height={96} />

        <div class="flex flex-col items-center gap-2 text-center">
          <h1 class="text-2xl font-extrabold md:mt-4">Konik Stable</h1>
          <p class="text-md">Manage your hoofpilot experience.</p>
        </div>

        <div class="flex flex-col items-stretch gap-4 self-stretch">
          <label class="flex items-start justify-center gap-3 py-3 text-center text-sm text-on-surface">
            <span class="relative mt-0.5 inline-flex items-center">
              <input type="checkbox" class="peer sr-only" checked={agreed()} onChange={(e) => setAgreed(e.currentTarget.checked)} />
              <span class="flex size-5 items-center justify-center rounded-sm border border-outline bg-surface-container-highest shadow-sm transition peer-focus:outline peer-focus:outline-2 peer-focus:outline-offset-2 peer-focus:outline-primary peer-checked:border-primary peer-checked:bg-primary">
                <span class="block size-2.5 rotate-45 border-b-2 border-r-2 border-on-primary opacity-0 transition peer-checked:opacity-100" />
              </span>
            </span>
            <span class="leading-5">
              I agree to the{' '}
              <a class="text-primary underline underline-offset-2" href="https://konik.ai/privacy/" target="_blank" rel="noreferrer">
                Terms of Service
              </a>
              .
            </span>
          </label>
          <Button
            class="h-14 gap-4 xs:h-16"
            onClick={handleSignIn}
            disabled={!agreed()}
            leading={<img src="/images/logo-github.svg" alt="" width={32} height={32} />}
          >
            Sign in with GitHub
          </Button>
        </div>

        <div class="flex justify-between gap-4">
          <p class="text-sm xs:text-md">Make sure to sign in with the same account if you have previously paired your Konik device.</p>

          <img src="/images/icon-comma-three-light.svg" alt="" width={32} height={32} />
        </div>
      </div>
      <div class="absolute bottom-4 left-4 text-xs text-on-surface-variant">
        Built by{' '}
        <a class="text-on-surface-variant underline underline-offset-2" href="https://konik.ai" target="_blank" rel="noreferrer">
          Konik.ai
        </a>
      </div>
    </div>
  )
}
