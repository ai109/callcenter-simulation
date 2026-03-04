"""
Callcenter model (SimPy)

- Interarrival time: exponential with mean MEAN_IAT seconds (100s baseline, 50s worst-case)
- Service time: normal(mean=270s, sd=60s), truncated at >= 0
- Queue limit: if >= 20 waiting in Resource.queue -> reject (counted)
- Goal: find minimal N agents so rejected/arrived <= 5%
"""

from __future__ import annotations
from collections.abc import Generator
import random
import math
import simpy


QUEUE_LIMIT = 20

# Simulation horizon (change if your course expects something else)
SIM_TIME = 8 * 60 * 60  # 8 hours in seconds


def exp_time(mean: float) -> float:
    # mean = 1/lambda
    return random.expovariate(1.0 / mean)


def normal_service(mean: float = 270.0, sd: float = 60.0) -> float:
    # Truncate at 0 to avoid negative times
    return max(0.0, random.gauss(mean, sd))


class Stats:
    def __init__(self) -> None:
        self.arrived = 0
        self.rejected = 0
        self.served = 0


def customer(
    env: simpy.Environment, cid: int, agents: simpy.Resource, stats: Stats
) -> Generator[simpy.events.Event, None, None]:
    stats.arrived += 1

    # Queue-limit rule from the sheet: reject if too many WAITING callers
    if len(agents.queue) >= QUEUE_LIMIT:
        stats.rejected += 1
        return

    with agents.request() as req:
        yield req
        yield env.timeout(normal_service())
        stats.served += 1


def arrivals(
    env: simpy.Environment, agents: simpy.Resource, stats: Stats, mean_iat: float
) -> Generator[simpy.events.Event, None, None]:
    cid = 0
    while env.now < SIM_TIME:
        yield env.timeout(exp_time(mean_iat))
        cid += 1
        env.process(customer(env, cid, agents, stats))


def run_once(n_agents: int, mean_iat: float, seed: int = 1) -> tuple[float, Stats]:
    random.seed(seed)
    env = simpy.Environment()
    agents = simpy.Resource(env, capacity=n_agents)
    stats = Stats()
    env.process(arrivals(env, agents, stats, mean_iat))
    env.run(until=SIM_TIME)

    rejection_rate = (stats.rejected / stats.arrived) if stats.arrived else 0.0
    return rejection_rate, stats


def find_min_agents(mean_iat: float, target_reject_rate: float = 0.05, n_min: int = 1, n_max: int = 10) -> None:
    print(f"\n=== Searching N agents for mean interarrival = {mean_iat}s (target reject <= {target_reject_rate:.1%}) ===")
    best = None

    for n in range(n_min, n_max + 1):
        rr, st = run_once(n_agents=n, mean_iat=mean_iat, seed=1)
        print(f"N={n:2d} | arrived={st.arrived:5d} served={st.served:5d} rejected={st.rejected:5d} | reject={rr:.2%}")
        if rr <= target_reject_rate and best is None:
            best = n

    if best is None:
        print(f"-> No N in [{n_min},{n_max}] reached the target. Increase n_max or SIM_TIME / replications.")
    else:
        print(f"-> Minimal N meeting target: {best}")


if __name__ == "__main__":
    # Baseline: mean arrival 100s
    find_min_agents(mean_iat=100.0)

    # Worst-case: mean arrival 50s
    find_min_agents(mean_iat=50.0)
