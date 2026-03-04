/**
 * Callcenter model (SimLuxJS)
 *
 * - Interarrival: exponential mean MEAN_IAT (100 baseline, 50 worst-case)
 * - Service: normal(270, 60) truncated at >= 0
 * - Queue limit: if queueLen >= 20 AND all agents busy -> reject
 * - Find minimal N agents with rejected/arrived <= 5%
 *
 */

const { SimLuxJS, SimEntity } = require("./SimLuxJS.js"); // adjust path as needed

const QUEUE_LIMIT = 20;
const SIM_TIME = 8 * 60 * 60; // 8 hours in seconds

function expTime(mean) {
  // mean = 1/lambda
  return -mean * Math.log(1 - Math.random());
}

// Box–Muller normal sample
function normalSample(mean, sd) {
  let u1 = 0,
    u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + sd * z0;
}

function serviceTime() {
  return Math.max(0, normalSample(270, 60));
}

class Stats {
  constructor() {
    this.arrived = 0;
    this.rejected = 0;
    this.served = 0;
  }
}

async function runOnce(nAgents, meanIAT, seedIgnored = true) {
  // (Optional) If you want reproducible RNG, swap Math.random with a seeded PRNG.
  const sim = new SimLuxJS(false);

  // We model "busy agents" and "queue length" explicitly.
  let busy = 0;
  let queueLen = 0;

  // ControlVariable is used so waiting callers can "waitUntil" an agent becomes free.  [oai_citation:6‡GitHub](https://github.com/htwddwiedem/SimLuxJS/blob/main/SimLuxJS.js)
  const state = sim.createControlVariable({ busy: 0, queueLen: 0 });

  const stats = new Stats();

  class Call extends SimEntity {
    constructor(id) {
      super();
      this.id = id;
    }

    async run() {
      stats.arrived += 1;

      // If all agents are busy, this call would have to wait -> queue-limit check applies
      if (busy >= nAgents) {
        if (queueLen >= QUEUE_LIMIT) {
          stats.rejected += 1;
          return;
        }
        queueLen += 1;
        await state.setValue({ busy, queueLen });

        // Wait until at least one agent is free
        await state.waitUntil((v) => v.busy < nAgents);

        // Leaving the queue (now going into service)
        queueLen -= 1;
        await state.setValue({ busy, queueLen });
      }

      // Start service
      busy += 1;
      await state.setValue({ busy, queueLen });

      await sim.advance(serviceTime());

      // Finish service
      busy -= 1;
      stats.served += 1;
      await state.setValue({ busy, queueLen });
    }
  }

  class ArrivalGenerator extends SimEntity {
    async run() {
      let id = 0;
      while (sim.getTime() < SIM_TIME) {
        await sim.advance(expTime(meanIAT));
        id += 1;
        sim.addSimEntity(new Call(id));
      }
    }
  }

  sim.addSimEntity(new ArrivalGenerator());
  await sim.run(); // run to completion
  const rejectRate = stats.arrived ? stats.rejected / stats.arrived : 0;
  return { rejectRate, stats };
}

async function findMinAgents(
  meanIAT,
  targetRejectRate = 0.05,
  nMin = 1,
  nMax = 10,
) {
  console.log(
    `\n=== Searching N agents for mean interarrival = ${meanIAT}s (target reject <= ${(targetRejectRate * 100).toFixed(1)}%) ===`,
  );

  let best = null;
  for (let n = nMin; n <= nMax; n++) {
    const { rejectRate, stats } = await runOnce(n, meanIAT);
    console.log(
      `N=${String(n).padStart(2)} | arrived=${String(stats.arrived).padStart(5)} served=${String(stats.served).padStart(5)} rejected=${String(stats.rejected).padStart(5)} | reject=${(rejectRate * 100).toFixed(2)}%`,
    );
    if (rejectRate <= targetRejectRate && best === null) best = n;
  }

  if (best === null) {
    console.log(
      `-> No N in [${nMin},${nMax}] reached the target. Increase nMax or SIM_TIME / replications.`,
    );
  } else {
    console.log(`-> Minimal N meeting target: ${best}`);
  }
}

(async () => {
  // Baseline: mean arrival 100s
  await findMinAgents(100);

  // Worst-case: mean arrival 50s
  await findMinAgents(50);
})();
