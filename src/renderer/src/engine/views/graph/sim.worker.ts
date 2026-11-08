// "Graph Worker": runs the force simulation off the main thread (protocol in ./simulation.ts).
import { GraphSimulation, PositionPoster, SimulationLoop } from './simulation'

const ctx = self as unknown as {
  postMessage(msg: any, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent) => void) | null
  SharedArrayBuffer?: typeof SharedArrayBuffer
}

let shared = false
if (typeof SharedArrayBuffer !== 'undefined') {
  try {
    const probe = new SharedArrayBuffer(1)
    ctx.postMessage({ ignore: true, shared: probe })
    shared = true
  } catch {
    shared = false
  }
}

const loop = new SimulationLoop(new GraphSimulation(), new PositionPoster((m, t) => ctx.postMessage(m, t), shared))
ctx.onmessage = e => loop.onMessage(e.data)
