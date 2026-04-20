import { For, Show, type VoidComponent } from 'solid-js'
import clsx from 'clsx'

import type { RouteSprites } from '~/api/sprites-worker-client'

const RouteSpriteStrip: VoidComponent<{ class?: string; sprites: RouteSprites | undefined }> = (props) => {
  return (
    <div class={clsx('relative flex w-full overflow-hidden bg-surface-container-high', props.class)}>
      <Show when={props.sprites} fallback={<div class="skeleton-loader size-full" />}>
        {(sprites) => (
          <>
            <For each={sprites().segmentUrls}>
              {(url) => (
                <Show when={url}>{(u) => <img src={u()} class="h-full w-auto max-w-none flex-none" alt="" draggable={false} />}</Show>
              )}
            </For>
            <Show when={sprites().lastTileUrl}>
              {(url) => (
                <div
                  class="h-full flex-1"
                  style={{
                    'background-image': `url(${url()})`,
                    'background-repeat': 'repeat-x',
                    'background-size': 'auto 100%',
                  }}
                />
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

export default RouteSpriteStrip
