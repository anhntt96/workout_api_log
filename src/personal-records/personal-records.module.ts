import { Module } from '@nestjs/common';
import { ExercisesModule } from '../exercises/exercises.module.js';
import { PersonalRecordsController } from './personal-records.controller.js';
import { PersonalRecordsRepository } from './personal-records.repository.js';
import { PersonalRecordsService } from './personal-records.service.js';

@Module({
  imports: [ExercisesModule],
  controllers: [PersonalRecordsController],
  providers: [PersonalRecordsService, PersonalRecordsRepository],
})
export class PersonalRecordsModule {}
