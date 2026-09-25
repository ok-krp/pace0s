import { Capacitor } from "@capacitor/core";
import { Health } from "@capgo/capacitor-health";

export interface DailyHealthAggregate {
  date: string;
  steps: number;
  activeCaloriesKcal: number;
  sleepMinutes: number;
}

export interface HealthConnectAvailability {
  available: boolean;
  platform: "android" | "ios" | "web";
  reason?: string;
}

const READ_PERMISSIONS = ["steps", "sleep", "heartRate", "calories"] as const;

function localDayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
  };
}

function overlapMinutes(
  startDate: string,
  endDate: string,
  rangeStart: number,
  rangeEnd: number,
): number {
  const start = Math.max(new Date(startDate).getTime(), rangeStart);
  const end = Math.min(new Date(endDate).getTime(), rangeEnd);
  return Math.max(0, end - start) / 60_000;
}

export class HealthConnectService {
  static async checkAvailability(): Promise<HealthConnectAvailability> {
    const platform = Capacitor.getPlatform() as "android" | "ios" | "web";

    if (platform !== "android") {
      return {
        available: false,
        platform,
        reason: "Health Connect is Android-only.",
      };
    }

    const result = await Health.isAvailable();

    return {
      available: result.available,
      platform: "android",
      reason: result.reason,
    };
  }

  static async requestPermissions(): Promise<void> {
    const availability = await this.checkAvailability();

    if (!availability.available) {
      throw new Error(availability.reason ?? "Health Connect is unavailable.");
    }

    const authorization = await Health.requestAuthorization({
      read: [...READ_PERMISSIONS],
      write: [],
    });

    if (authorization.readDenied.length > 0) {
      throw new Error(
        `Health Connect permissions denied: ${authorization.readDenied.join(", ")}`,
      );
    }
  }

  static async getToday(now = new Date()): Promise<DailyHealthAggregate> {
    const availability = await this.checkAvailability();

    if (!availability.available) {
      throw new Error(availability.reason ?? "Health Connect is unavailable.");
    }

    const { start, end, date } = localDayBounds(now);
    const rangeStart = new Date(start).getTime();
    const rangeEnd = new Date(end).getTime();

    const [steps, calories, sleep] = await Promise.all([
      Health.queryAggregated({
        dataType: "steps",
        startDate: start,
        endDate: end,
        bucket: "day",
        aggregation: "sum",
      }),
      Health.queryAggregated({
        dataType: "calories",
        startDate: start,
        endDate: end,
        bucket: "day",
        aggregation: "sum",
      }),
      Health.readSamples({
        dataType: "sleep",
        startDate: start,
        endDate: end,
        limit: 1000,
        ascending: true,
      }),
    ]);

    const sleepMinutes = sleep.samples.reduce(
      (total, sample) =>
        total +
        overlapMinutes(
          sample.startDate,
          sample.endDate,
          rangeStart,
          rangeEnd,
        ),
      0,
    );

    return {
      date,
      steps: Number(steps.samples[0]?.value ?? 0),
      activeCaloriesKcal: Number(calories.samples[0]?.value ?? 0),
      sleepMinutes: Math.round(sleepMinutes * 100) / 100,
    };
  }
}
