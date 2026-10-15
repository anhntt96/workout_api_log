import { Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller.js';
import { ExercisesRepository } from './exercises.repository.js';

@Module({
  controllers: [ExercisesController],
  providers: [ExercisesRepository],
  exports: [ExercisesRepository],
})
export class ExercisesModule {}
