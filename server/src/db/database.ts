import { Place, Tag } from '../types';
import { db, closeDb, reinitialize } from './database.connection';

interface PlaceWithCategory extends Place {
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
}

interface PlaceWithTags extends Place {
  category: { id: number; name: string; color: string; icon: string } | null;
  tags: Tag[];
  ratings: { user_id: number; username: string; avatar: string | null; rating: number }[];
  rating_avg: number | null;
  rating_count: number;
}

function getPlaceWithTags(placeId: number | string): PlaceWithTags | null {
  const place = db.prepare(`
    SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM places p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `).get(placeId) as PlaceWithCategory | undefined;

  if (!place) return null;

  const tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN place_tags pt ON t.id = pt.tag_id
    WHERE pt.place_id = ?
  `).all(placeId) as Tag[];

  // Collaborative ratings (#1435): every voter with username/avatar for the
  // who-voted tooltip; the displayed value is the average.
  const ratings = db.prepare(`
    SELECT pr.user_id, u.username, u.avatar, pr.rating FROM place_ratings pr
    JOIN users u ON pr.user_id = u.id
    WHERE pr.place_id = ? ORDER BY pr.created_at
  `).all(placeId) as { user_id: number; username: string; avatar: string | null; rating: number }[];

  return {
    ...place,
    category: place.category_id ? {
      id: place.category_id,
      name: place.category_name!,
      color: place.category_color!,
      icon: place.category_icon!,
    } : null,
    tags,
    ratings,
    rating_avg: ratings.length > 0 ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : null,
    rating_count: ratings.length,
  };
}

interface TripAccess {
  id: number;
  user_id: number;
  currency: string | null;
}

function canAccessTrip(tripId: number | string, userId: number): TripAccess | undefined {
  return db.prepare(`
    SELECT t.id, t.user_id, t.currency FROM trips t
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
    WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)
  `).get(userId, tripId, userId) as TripAccess | undefined;
}

function isOwner(tripId: number | string, userId: number): boolean {
  return !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId);
}


export { db, closeDb, reinitialize, getPlaceWithTags, canAccessTrip, isOwner };
export type { TripAccess, PlaceWithTags };
