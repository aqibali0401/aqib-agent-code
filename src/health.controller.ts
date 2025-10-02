import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('/')
  getRoot() {
    return {
      status: 200,
      isSuccess: true,
      message: 'Whoa! You are connected to the server',
      data: {},
    };
  }
}


