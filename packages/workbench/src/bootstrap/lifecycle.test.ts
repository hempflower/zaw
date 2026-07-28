import { describe, expect, it, vi } from "vitest";
import { Container } from "inversify";
import {
  ILifecycleService,
  LifecyclePhase,
} from "../platform/lifecycle/lifecycle";
import { LifecycleService } from "../platform/lifecycle/lifecycle-service";
import {
  IWorkbenchContribution,
  IWorkbenchContributionsRegistry,
  WorkbenchContributionsRegistry,
  type WorkbenchContributionDescriptor,
} from "../workbench/contributions/workbench-contributions";

describe("LifecycleService", () => {
  it("starts at Starting phase", () => {
    const service = new LifecycleService();
    expect(service.phase).toBe(LifecyclePhase.Starting);
  });

  it("advances phases monotonically", () => {
    const service = new LifecycleService();
    service.setPhase(LifecyclePhase.Ready);
    expect(service.phase).toBe(LifecyclePhase.Ready);
    service.setPhase(LifecyclePhase.Restored);
    expect(service.phase).toBe(LifecyclePhase.Restored);
  });

  it("rejects backward phase movement", () => {
    const service = new LifecycleService();
    service.setPhase(LifecyclePhase.Ready);
    expect(() => service.setPhase(LifecyclePhase.Starting)).toThrow();
  });

  it("rejects duplicate phase", () => {
    const service = new LifecycleService();
    service.setPhase(LifecyclePhase.Ready);
    expect(() => service.setPhase(LifecyclePhase.Ready)).toThrow();
  });

  it("emits onDidChangePhase", () => {
    const service = new LifecycleService();
    const phases: LifecyclePhase[] = [];
    service.onDidChangePhase((phase) => phases.push(phase));
    service.setPhase(LifecyclePhase.Ready);
    service.setPhase(LifecyclePhase.Restored);
    expect(phases).toEqual([LifecyclePhase.Ready, LifecyclePhase.Restored]);
  });

  it("when() resolves immediately if phase already reached", async () => {
    const service = new LifecycleService();
    service.setPhase(LifecyclePhase.Ready);
    await expect(
      service.when(LifecyclePhase.Starting),
    ).resolves.toBeUndefined();
    await expect(service.when(LifecyclePhase.Ready)).resolves.toBeUndefined();
  });

  it("when() waits for future phase", async () => {
    const service = new LifecycleService();
    const promise = service.when(LifecyclePhase.Restored);
    service.setPhase(LifecyclePhase.Ready);
    service.setPhase(LifecyclePhase.Restored);
    await expect(promise).resolves.toBeUndefined();
  });

  it("fires onWillShutdown", () => {
    const service = new LifecycleService();
    const listener = vi.fn();
    service.onWillShutdown(listener);
    service.shutdown();
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("WorkbenchContributionsRegistry", () => {
  function setup() {
    const lifecycle = new LifecycleService();
    const registry = new WorkbenchContributionsRegistry();
    const container = new Container();
    return { lifecycle, registry, container };
  }

  it("registers and starts a contribution at Ready phase", () => {
    const { lifecycle, registry, container } = setup();
    const ctor = vi.fn();

    class TestContribution {
      constructor() {
        ctor();
      }
    }

    container.bind(TestContribution).toSelf();
    registry.start(lifecycle, container);
    registry.register({
      id: "test.ready",
      ctor: TestContribution,
      phase: LifecyclePhase.Ready,
    });

    lifecycle.setPhase(LifecyclePhase.Ready);

    // Contribution should be instantiated once
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate contribution IDs", () => {
    const { registry } = setup();
    const descriptor: WorkbenchContributionDescriptor = {
      id: "test.dup",
      ctor: class {},
      phase: LifecyclePhase.Ready,
    };
    registry.register(descriptor);
    expect(() => registry.register(descriptor)).toThrow("already registered");
  });

  it("starts contribution immediately if phase already passed", () => {
    const { lifecycle, registry, container } = setup();
    const ctor = vi.fn();

    class TestContribution {
      constructor() {
        ctor();
      }
    }

    container.bind(TestContribution).toSelf();
    lifecycle.setPhase(LifecyclePhase.Ready);
    lifecycle.setPhase(LifecyclePhase.Restored);
    registry.start(lifecycle, container);

    registry.register({
      id: "test.late",
      ctor: TestContribution,
      phase: LifecyclePhase.Ready,
    });

    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it("isolates contribution construction failure", () => {
    const { lifecycle, registry, container } = setup();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    class FailingContribution {
      constructor() {
        throw new Error("Boom");
      }
    }

    container.bind(FailingContribution).toSelf();
    registry.start(lifecycle, container);

    registry.register({
      id: "test.fail",
      ctor: FailingContribution,
      phase: LifecyclePhase.Ready,
    });

    // Should not throw; error is caught and logged
    lifecycle.setPhase(LifecyclePhase.Ready);

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("disposes contributions in reverse registration order on shutdown", () => {
    const { lifecycle, registry, container } = setup();
    const disposed: string[] = [];

    class ContributionA {
      dispose() {
        disposed.push("A");
      }
    }
    class ContributionB {
      dispose() {
        disposed.push("B");
      }
    }

    container.bind(ContributionA).toSelf().inSingletonScope();
    container.bind(ContributionB).toSelf().inSingletonScope();

    registry.start(lifecycle, container);
    registry.register({
      id: "test.a",
      ctor: ContributionA,
      phase: LifecyclePhase.Ready,
    });
    registry.register({
      id: "test.b",
      ctor: ContributionB,
      phase: LifecyclePhase.Ready,
    });
    lifecycle.setPhase(LifecyclePhase.Ready);

    lifecycle.shutdown();
    // Reverse registration order: B registered last, disposed first
    expect(disposed).toEqual(["B", "A"]);
  });

  it("unregister disposes and removes contribution", () => {
    const { lifecycle, registry, container } = setup();
    const disposed = vi.fn();

    class TestContribution {
      dispose = disposed;
    }

    container.bind(TestContribution).toSelf().inSingletonScope();
    registry.start(lifecycle, container);

    const handle = registry.register({
      id: "test.rm",
      ctor: TestContribution,
      phase: LifecyclePhase.Ready,
    });
    lifecycle.setPhase(LifecyclePhase.Ready);

    expect(disposed).not.toHaveBeenCalled();
    handle.dispose();
    expect(disposed).toHaveBeenCalledOnce();

    // Re-registering with same ID should work after unregister
    registry.register({
      id: "test.rm",
      ctor: TestContribution,
      phase: LifecyclePhase.Ready,
    });
  });

  it("records contribution instantiation timing", () => {
    const { lifecycle, registry, container } = setup();
    const timings: Array<{ id: string; durationMs: number }> = [];
    registry.onDidInstantiate((timing) => timings.push(timing));
    class TimedContribution {}
    container.bind(TimedContribution).toSelf();
    registry.start(lifecycle, container);
    registry.register({
      id: "test.timing",
      ctor: TimedContribution,
      phase: LifecyclePhase.Ready,
    });
    lifecycle.setPhase(LifecyclePhase.Ready);
    expect(timings).toEqual([
      expect.objectContaining({
        id: "test.timing",
        durationMs: expect.any(Number),
      }),
    ]);
  });
});

describe("R1 Lifecycle integration", () => {
  it("phases advance in correct order during simulated startup", () => {
    const lifecycle = new LifecycleService();
    const phases: LifecyclePhase[] = [];
    lifecycle.onDidChangePhase((phase) => phases.push(phase));

    // Simulate workbench startup sequence
    expect(lifecycle.phase).toBe(LifecyclePhase.Starting);
    lifecycle.setPhase(LifecyclePhase.Ready);
    lifecycle.setPhase(LifecyclePhase.Restored);

    expect(phases).toEqual([LifecyclePhase.Ready, LifecyclePhase.Restored]);
  });

  it("Eventually phase contributions do not block Ready phase", async () => {
    const lifecycle = new LifecycleService();
    const registry = new WorkbenchContributionsRegistry();
    const container = new Container();
    const readyCtor = vi.fn();
    const eventuallyCtor = vi.fn();

    class ReadyContribution {
      constructor() {
        readyCtor();
      }
    }
    class EventuallyContribution {
      constructor() {
        eventuallyCtor();
      }
    }

    container.bind(ReadyContribution).toSelf();
    container.bind(EventuallyContribution).toSelf();

    registry.start(lifecycle, container);

    registry.register({
      id: "test.ready",
      ctor: ReadyContribution,
      phase: LifecyclePhase.Ready,
    });
    registry.register({
      id: "test.eventually",
      ctor: EventuallyContribution,
      phase: LifecyclePhase.Eventually,
    });

    // Ready phase should only instantiate Ready contributions
    lifecycle.setPhase(LifecyclePhase.Ready);
    expect(readyCtor).toHaveBeenCalledTimes(1);
    expect(eventuallyCtor).not.toHaveBeenCalled();

    // Eventually phase should instantiate deferred contributions
    lifecycle.setPhase(LifecyclePhase.Restored);
    lifecycle.setPhase(LifecyclePhase.Eventually);
    expect(eventuallyCtor).toHaveBeenCalledTimes(1);
  });
});
