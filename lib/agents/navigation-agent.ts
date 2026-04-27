/**
 * Navigation Agent — Handles Google Maps routes, nearby places, traffic
 */
import type { AgentHandler, AgentResult } from './types';

const getGoogleMapsRouteUrl = (destination: string, origin?: string, mode?: string) => {
  const params = new URLSearchParams({ api: '1', destination });
  if (origin) params.set('origin', origin);
  if (mode && ['driving', 'walking', 'bicycling', 'transit'].includes(mode)) {
    params.set('travelmode', mode);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

export const handle: AgentHandler = async (toolName, args, _ctx): Promise<AgentResult> => {
  switch (toolName) {
    case 'find_route':
    case 'maps_navigate': {
      const destination = typeof args.destination === 'string' ? args.destination : '';
      if (!destination) return { status: 'error', message: 'Destination is required for navigation.' };
      const origin = typeof args.origin === 'string' ? args.origin : undefined;
      const mode = typeof args.modeOfTransport === 'string' ? args.modeOfTransport.toLowerCase() : undefined;
      return {
        status: 'success',
        message: `I prepared a Google Maps route to ${destination}.`,
        data: { destination, origin, mode: mode || 'driving', url: getGoogleMapsRouteUrl(destination, origin, mode) },
      };
    }

    case 'find_nearby_places': {
      const placeType = typeof args.placeType === 'string' ? args.placeType.trim() : '';
      if (!placeType) return { status: 'error', message: 'A place type is required for nearby search.' };
      const radius = typeof args.radius === 'number' ? args.radius : undefined;
      const query = radius ? `${placeType} within ${radius} km` : placeType;
      return {
        status: 'success',
        message: `I opened a live Google Maps search for nearby ${placeType}.`,
        data: { placeType, radiusKm: radius, url: `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query }).toString()}` },
      };
    }

    case 'get_traffic_info': {
      const location = typeof args.location === 'string' ? args.location.trim() : '';
      if (!location) return { status: 'error', message: 'A location is required for traffic lookup.' };
      return {
        status: 'success',
        message: `I prepared a live Google Maps traffic view for ${location}.`,
        data: { location, url: `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: `${location} traffic` }).toString()}` },
      };
    }

    default:
      return { status: 'error', message: `Navigation agent does not support tool: ${toolName}` };
  }
};
