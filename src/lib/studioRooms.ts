/**
 * Rooms a class can be held in (Admin → Master location, Class types default room).
 * Must match the database list `class_location` ('Studio 1' and 'Studio 2' are retired).
 */
export const STUDIO_ROOMS = ["Mat Room", "Reformer Room", "Wellzone"] as const;

export const DEFAULT_STUDIO_ROOM = "Mat Room";
