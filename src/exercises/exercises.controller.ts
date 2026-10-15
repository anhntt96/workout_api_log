import { Controller, Get } from '@nestjs/common';
import { type CatalogExercise, ExercisesRepository } from './exercises.repository.js';

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExercisesRepository) {}

  /** The fixed exercise catalog with muscle groups; clients log with these names (ADR 0004). */
  @Get()
  async list(): Promise<{ data: CatalogExercise[] }> {
    return { data: await this.exercises.findAll() };
  }
}
