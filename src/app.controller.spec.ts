import { AppController } from './app.controller';

describe('AppController', () => {
  it('reports a healthy status on /health', () => {
    expect(new AppController().getHealth()).toEqual({ status: 'ok' });
  });
});
