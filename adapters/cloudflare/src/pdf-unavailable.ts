import { HttpException } from '@nestjs/common';
/** PDF native rendering is deliberately unavailable in the initial Workers profile. */
export class PDFParse {
  constructor() { throw new HttpException('PDF import is not supported by the Cloudflare demo yet.', 501); }
}
