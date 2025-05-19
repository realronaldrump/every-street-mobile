import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './MapComponent.css';

function MapComponent({ segments, userLocation, routeGeoJSON, completedSegmentIds, targetSegmentId, isNewSegmentsData }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const userLocationMarker = useRef(null);

  useEffect(() => {
    if (map.current) {
        console.log("MapComponent: Map instance already exists, skipping re-initialization.");
        return;
    }
    
    const maptilerApiKey = 'w4Op5iaaZNPuhILZH1e3'; // Your provided MapTiler Key
    if (!maptilerApiKey) {
        console.error("MapComponent: MapTiler API Key is missing. Map will not load.");
        return;
    }

    console.log("MapComponent: Initializing map with MapTiler style (useEffect with empty deps).");

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${maptilerApiKey}`,
      center: userLocation ? [userLocation.longitude, userLocation.latitude] : [-98.5795, 39.8283],
      zoom: userLocation ? 12 : 3,
    });

    map.current.on('load', () => {
      console.log("MapComponent: Map 'load' event fired.");
      setMapLoaded(true);
      map.current.resize(); // Ensure map resizes correctly
    });

    map.current.on('error', (e) => {
      console.error("MapComponent: A MapLibre GL error occurred:", e.error ? e.error : e);
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    return () => {
      if (map.current) {
        console.log("MapComponent: Cleaning up map (unmount or before re-run if deps changed).");
        map.current.remove();
        map.current = null;
        setMapLoaded(false);
      }
    };
  }, []); // Empty dependency array ensures this runs only on mount/unmount (or StrictMode equivalent)


  useEffect(() => {
    if (!map.current || !mapLoaded || !userLocation) return;
    const { latitude, longitude } = userLocation;
    const userLngLat = [longitude, latitude];

    if (userLocationMarker.current) {
      userLocationMarker.current.setLngLat(userLngLat);
    } else {
      userLocationMarker.current = new maplibregl.Marker({ color: '#32CD32' })
        .setLngLat(userLngLat)
        .addTo(map.current);
    }
    
    const mapBounds = map.current.getBounds();
    // Smart zoom/pan to user location
    if (segments === null || (segments && segments.features.length === 0)){ // Only fly if no segments loaded
        if (!mapBounds.contains(userLngLat)) {
            if (map.current.getZoom() < 10) { 
                map.current.flyTo({ center: userLngLat, zoom: 14, speed: 0.8 });
            } else { 
                map.current.panTo(userLngLat);
            }
        } else if (map.current.getZoom() < 5) { 
            map.current.flyTo({ center: userLngLat, zoom: 14, speed: 0.8 });
        }
    }
  }, [mapLoaded, userLocation, segments]);


  useEffect(() => {
    if (!map.current || !mapLoaded) {
      console.log("MapComponent (Segments Effect): Map not ready or not loaded.");
      return;
    }
    console.log("MapComponent (Segments Effect): Running. Segments:", segments, "Completed:", completedSegmentIds, "Target:", targetSegmentId);

    const sourceId = 'all-segments';
    const undrivenLayerId = 'undriven-segments-layer';
    const completedLayerId = 'completed-segments-layer';
    const targetLayerId = 'target-segment-layer';

    const currentCompletedIdsArray = Array.from(completedSegmentIds || []);
    console.log("MapComponent (Segments Effect): currentCompletedIdsArray:", currentCompletedIdsArray);


    if (segments && segments.features && segments.features.length > 0) {
      console.log("MapComponent (Segments Effect): Processing segments. Count:", segments.features.length);
      if (map.current.getSource(sourceId)) {
        console.log("MapComponent (Segments Effect): Updating existing source 'all-segments'.");
        map.current.getSource(sourceId).setData(segments);
      } else {
        console.log("MapComponent (Segments Effect): Adding new source 'all-segments'.");
        map.current.addSource(sourceId, {
          type: 'geojson',
          data: segments,
        });
      }

      const undrivenFilter = ['all', 
        ['!', ['in', ['get', 'unique_app_id'], ['literal', currentCompletedIdsArray]]],
        targetSegmentId ? ['!=', ['get', 'unique_app_id'], targetSegmentId] : true
      ];
      const completedFilter = ['in', ['get', 'unique_app_id'], ['literal', currentCompletedIdsArray]];
      const targetFilter = targetSegmentId ? ['==', ['get', 'unique_app_id'], targetSegmentId] : ['literal', false];

      console.log("MapComponent (Segments Effect): Undriven filter:", JSON.stringify(undrivenFilter));
      console.log("MapComponent (Segments Effect): Completed filter:", JSON.stringify(completedFilter));
      console.log("MapComponent (Segments Effect): Target filter:", JSON.stringify(targetFilter));

      // Undriven Segments Layer
      if (!map.current.getLayer(undrivenLayerId)) {
        console.log("MapComponent (Segments Effect): Adding undriven layer.");
        map.current.addLayer({
          id: undrivenLayerId, type: 'line', source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#00BFFF', 'line-width': 3.5, 'line-opacity': 0.7 },
          filter: undrivenFilter
        });
      } else {
        console.log("MapComponent (Segments Effect): Setting filter for undriven layer.");
         map.current.setFilter(undrivenLayerId, undrivenFilter);
      }

      // Completed Segments Layer
      if (!map.current.getLayer(completedLayerId)) {
        console.log("MapComponent (Segments Effect): Adding completed layer.");
        map.current.addLayer({
          id: completedLayerId, type: 'line', source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#808080', 'line-width': 2.5, 'line-opacity': 0.5, 'line-dasharray': [2, 2] },
          filter: completedFilter
        });
      } else {
        console.log("MapComponent (Segments Effect): Setting filter for completed layer.");
         map.current.setFilter(completedLayerId, completedFilter);
      }

      // Target Segment Layer
      if (!map.current.getLayer(targetLayerId)) {
        console.log("MapComponent (Segments Effect): Adding target layer.");
        map.current.addLayer({
          id: targetLayerId, type: 'line', source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#FFA500', 'line-width': 5, 'line-opacity': 0.9 },
          filter: targetFilter
        });
      } else {
        console.log("MapComponent (Segments Effect): Setting filter for target layer.");
        map.current.setFilter(targetLayerId, targetFilter);
      }
      
      if (isNewSegmentsData && segments.features.length > 0) {
        console.log("MapComponent (Segments Effect): Fitting bounds for new segments data.");
        try {
            const bounds = new maplibregl.LngLatBounds();
            segments.features.forEach(feature => {
              if (feature.geometry && feature.geometry.coordinates) {
                const extendBoundsForCoordinates = (coordsArray) => {
                  if (Array.isArray(coordsArray) && coordsArray.length > 0) {
                    if (typeof coordsArray[0] === 'number' && typeof coordsArray[1] === 'number' && coordsArray.length === 2) { 
                        bounds.extend(coordsArray); 
                    } else { 
                        coordsArray.forEach(coordOrSubArray => extendBoundsForCoordinates(coordOrSubArray)); 
                    }
                  }
                };
                extendBoundsForCoordinates(feature.geometry.coordinates);
              }
            });
            if (!bounds.isEmpty()) {
              map.current.fitBounds(bounds, {
                padding: { top: 70, bottom: 70, left: 70, right: 70 },
                maxZoom: 17, duration: 1000,
              });
               console.log("MapComponent (Segments Effect): fitBounds called.");
            } else {
                console.warn("MapComponent (Segments Effect): Calculated bounds are empty, not fitting.");
            }
          } catch (e) { console.error("MapComponent (Segments Effect): Error calculating/fitting bounds:", e); }
        } else {
            console.log("MapComponent (Segments Effect): Not fitting bounds (not new segments data or no features). isNewSegmentsData:", isNewSegmentsData);
        }

    } else { 
      console.log("MapComponent (Segments Effect): No segments to display or segments cleared. Removing layers.");
      if (map.current.getLayer(undrivenLayerId)) map.current.removeLayer(undrivenLayerId);
      if (map.current.getLayer(completedLayerId)) map.current.removeLayer(completedLayerId);
      if (map.current.getLayer(targetLayerId)) map.current.removeLayer(targetLayerId);
      if (map.current.getSource(sourceId)) map.current.removeSource(sourceId);
    }
  }, [mapLoaded, segments, completedSegmentIds, targetSegmentId, isNewSegmentsData]); // Added isNewSegmentsData

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const routeSourceId = 'calculated-route';
    const routeLayerId = routeSourceId + '-layer';

    if (routeGeoJSON && routeGeoJSON.geometry) {
      console.log("MapComponent (Route Effect): Displaying route.");
      if (map.current.getSource(routeSourceId)) {
        map.current.getSource(routeSourceId).setData(routeGeoJSON);
      } else {
        map.current.addSource(routeSourceId, { type: 'geojson', data: routeGeoJSON });
        map.current.addLayer({
          id: routeLayerId, type: 'line', source: routeSourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#76FF03', 'line-width': 4.5, 'line-opacity': 0.9, 'line-dasharray': [2, 1] }
        });
      }
    } else {
      console.log("MapComponent (Route Effect): No route to display or route cleared.");
      if (map.current.getLayer(routeLayerId)) map.current.removeLayer(routeLayerId);
      if (map.current.getSource(routeSourceId)) map.current.removeSource(routeSourceId);
    }
  }, [mapLoaded, routeGeoJSON]);

  return <div ref={mapContainer} className="map-component-container" />;
}

export default MapComponent;