import { Injectable } from '@nestjs/common';
/** Timers do not provide durable scheduling in Workers. A later profile will use alarms. */
@Injectable()
export class CronRegistrarService {
  isEnabled(): boolean { return false; }
  register(): boolean { return false; }
  unregister(): void {}
  get jobCount(): number { return 0; }
  onApplicationShutdown(): void {}
}
