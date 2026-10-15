import { Module } from '@nestjs/common';
import { ExercisesModule } from '../exercises/exercises.module.js';
import { WorkoutEntriesController } from './workout-entries.controller.js';
import { WorkoutEntriesRepository } from './workout-entries.repository.js';
import { WorkoutEntriesService } from './workout-entries.service.js';

@Module({
  imports: [ExercisesModule],
  controllers: [WorkoutEntriesController],
  providers: [WorkoutEntriesService, WorkoutEntriesRepository],
})
export class WorkoutsModule {}
