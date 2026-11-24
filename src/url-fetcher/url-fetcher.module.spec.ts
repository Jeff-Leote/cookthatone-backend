import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UrlNotAllowedError } from './errors/url-fetcher.errors';
import { SafeUrlFetcherService } from './services/safe-url-fetcher.service';
import { UrlFetcherModule } from './url-fetcher.module';

describe('UrlFetcherModule', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fournit le service avec le transport de production', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const moduleRef = await Test.createTestingModule({
      imports: [UrlFetcherModule],
    }).compile();

    const service = moduleRef.get(SafeUrlFetcherService);

    expect(service).toBeInstanceOf(SafeUrlFetcherService);
    await expect(service.fetch('http://169.254.169.254/')).rejects.toThrow(
      UrlNotAllowedError,
    );
  });
});
