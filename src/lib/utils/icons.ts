import { addCollection } from '@iconify/svelte/dist/functions'
import mdiIcons from '@iconify-json/mdi/icons.json'

const needed = [
    'account-details',
    'alert-circle',
    'alert-circle-outline',
    'api',
    'arrow-left',
    'arrow-left-bold',
    'arrow-right-bold',
    'chart-box-outline',
    'check',
    'chevron-down',
    'circle',
    'clock-edit',
    'close',
    'close-circle-outline',
    'code-tags',
    'comment-edit',
    'content-copy',
    'content-paste',
    'database-outline',
    'delete',
    'delete-outline',
    'delete-sweep',
    'file-document-outline',
    'file-import-outline',
    'link-variant',
    'lock',
    'lock-open-outline',
    'lock-outline',
    'magnify',
    'minus',
    'pencil',
    'play-circle',
    'playlist-remove',
    'plus',
    'plus-circle-outline',
    'refresh',
    'rename-outline',
    'restore',
    'send',
    'send-circle-outline',
    'stop-circle',
    'theme-light-dark',
    'tune-variant'
]

const filtered = {
    ...mdiIcons,
    icons: Object.fromEntries(Object.entries(mdiIcons.icons).filter(([name]) => needed.includes(name))),
    ...(mdiIcons.aliases && {
        aliases: Object.fromEntries(Object.entries(mdiIcons.aliases).filter(([name]) => needed.includes(name)))
    })
}

export function registerIcons() {
    addCollection(filtered)
}
