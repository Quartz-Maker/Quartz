// `moment` export: moment 2.30.1 with all locales (moment-with-locales), also exposed as
// `window.moment` (plugins expect it).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type MomentNS from 'moment'
// @ts-ignore — the with-locales build has no own typings (same API as 'moment')
import momentWithLocales from 'moment/min/moment-with-locales'

export const moment: typeof MomentNS = momentWithLocales as any

if (typeof window !== 'undefined' && !(window as any).moment) (window as any).moment = moment
