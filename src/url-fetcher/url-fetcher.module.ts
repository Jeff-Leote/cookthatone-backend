import { Module } from '@nestjs/common';
import { SafeUrlFetcherService } from './services/safe-url-fetcher.service';
import { NodeHttpTransport } from './transport/node-http-transport';
import { URL_FETCH_TRANSPORT } from './url-fetcher.constants';

@Module({
  providers: [
    SafeUrlFetcherService,
    { provide: URL_FETCH_TRANSPORT, useFactory: () => new NodeHttpTransport() },
  ],
  exports: [SafeUrlFetcherService],
})
export class UrlFetcherModule {}
