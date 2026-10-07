/** No request queue: excess address work must retry rather than exhaust Core. */
export class AddressReadAdmission {
  private active = 0;
  constructor(private readonly maximum = 2) {}
  async run<T>(read: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) throw Object.assign(new Error('Address lookup is busy'), { code: 'EADDRESSBUSY' });
    this.active++;
    try { return await read(); } finally { this.active--; }
  }
}
export const addressReadAdmission = new AddressReadAdmission();
