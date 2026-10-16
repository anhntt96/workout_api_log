import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { FieldError } from '../common/errors/request-validation.error.js';
import { PG_POOL } from '../database/database.module.js';
import { escapeLikePattern } from './like-pattern.js';

export interface CatalogExercise {
  name: string;
  muscleGroups: string[];
}

export interface ExerciseRef {
  id: string;
  /** Canonical catalog name. */
  name: string;
}

export interface ExerciseFilter {
  /** Case-insensitive substring of the exercise name, matched literally. */
  nameContains?: string;
  /** Exact muscle group name, case-insensitive. */
  muscleGroup?: string;
}

/** Lookup key for exercise names: trimmed and case-insensitive (ADR 0004). */
export function exerciseKey(name: string): string {
  return name.trim().toLowerCase();
}

/** The standard 400 detail for a name that is not in the catalog. */
export function unknownExercise(field: string, name: string): FieldError {
  return { field, message: `Unknown exercise "${name}". GET /exercises lists the valid names` };
}

@Injectable()
export class ExercisesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findAll(): Promise<CatalogExercise[]> {
    const { rows } = await this.pool.query<{ name: string; muscle_groups: string[] }>(
      `SELECT e.name::text AS name,
              coalesce(array_agg(m.name::text ORDER BY m.name) FILTER (WHERE m.id IS NOT NULL), '{}') AS muscle_groups
       FROM exercises e
       LEFT JOIN exercise_muscle_groups em ON em.exercise_id = e.id
       LEFT JOIN muscle_groups m ON m.id = em.muscle_group_id
       GROUP BY e.id
       ORDER BY e.name`,
    );
    return rows.map((row) => ({ name: row.name, muscleGroups: row.muscle_groups }));
  }

  /** Resolves names to catalog exercises, keyed by `exerciseKey`. Unknown names are absent from the map. */
  async resolveNames(names: readonly string[]): Promise<Map<string, ExerciseRef>> {
    const keys = [...new Set(names.map(exerciseKey))];
    const { rows } = await this.pool.query<ExerciseRef>(
      'SELECT id, name::text AS name FROM exercises WHERE name = ANY($1::citext[])',
      [keys],
    );
    return new Map(rows.map((row) => [exerciseKey(row.name), row]));
  }

  /** Ids of exercises matching every given filter. */
  async findIds(filter: ExerciseFilter): Promise<string[]> {
    const namePattern =
      filter.nameContains === undefined ? null : `%${escapeLikePattern(filter.nameContains)}%`;
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT e.id
       FROM exercises e
       WHERE ($1::text IS NULL OR e.name::text ILIKE $1)
         AND ($2::citext IS NULL OR EXISTS (
               SELECT 1
               FROM exercise_muscle_groups em
               JOIN muscle_groups m ON m.id = em.muscle_group_id
               WHERE em.exercise_id = e.id AND m.name = $2::citext))`,
      [namePattern, filter.muscleGroup ?? null],
    );
    return rows.map((row) => row.id);
  }

  async listMuscleGroups(): Promise<string[]> {
    const { rows } = await this.pool.query<{ name: string }>(
      'SELECT name::text AS name FROM muscle_groups ORDER BY name',
    );
    return rows.map((row) => row.name);
  }
}
