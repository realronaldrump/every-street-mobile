import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './MapComponent.css';

function MapComponent({ segments, userLocation, routeGeoJSON, completedSegmentIds, targetSegmentId, isNewSegmentsData }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const userLocationMarker = useRef(null);
  const userLocationRadius = useRef(null);
  const userHeading = useRef(null);
  const followingUser = useRef(true); // Start following user by default

  // Function to recenter map on user (used by the recenter button in App.jsx)
  useEffect(() => {
    if (!map.current || !userLocation) return;
    
    const recenterMapButton = document.getElementById('recenter-map');
    if (recenterMapButton) {
      const handleRecenter = () => {
        if (userLocation) {
          map.current.flyTo({
            center: [userLocation.longitude, userLocation.latitude],
            zoom: 16,
            pitch: 45, // Add some pitch for 3D effect
            bearing: userHeading.current || 0, // Use heading if available
            duration: 1000
          });
          followingUser.current = true;
        }
      };
      
      recenterMapButton.addEventListener('click', handleRecenter);
      return () => recenterMapButton.removeEventListener('click', handleRecenter);
    }
  }, [userLocation, mapLoaded]);

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
      zoom: userLocation ? 16 : 3,
      pitch: 45, // Add some 3D perspective for navigation
      antialias: true // Smoother rendering
    });

    // Add custom user interaction handlers
    map.current.on('dragstart', () => {
      followingUser.current = false; // Stop following user when manually panning
    });

    map.current.on('load', () => {
      console.log("MapComponent: Map 'load' event fired.");
      setMapLoaded(true);
      map.current.resize(); // Ensure map resizes correctly
      
      // Add 3D buildings layer for a more realistic navigation experience
      map.current.addLayer({
        'id': '3d-buildings',
        'source': 'composite',
        'source-layer': 'building',
        'filter': ['==', 'extrude', 'true'],
        'type': 'fill-extrusion',
        'minzoom': 14,
        'paint': {
          'fill-extrusion-color': '#aaa',
          'fill-extrusion-height': [
            'interpolate', ['linear'], ['zoom'],
            14, 0,
            16, ['get', 'height']
          ],
          'fill-extrusion-base': [
            'interpolate', ['linear'], ['zoom'],
            14, 0,
            16, ['get', 'min_height']
          ],
          'fill-extrusion-opacity': 0.6
        }
      }, 'road-label');
    });

    map.current.on('error', (e) => {
      console.error("MapComponent: A MapLibre GL error occurred:", e.error ? e.error : e);
    });

    // Add minimal controls only - better for mobile
    const navControl = new maplibregl.NavigationControl({
      showCompass: true,
      showZoom: true,
      visualizePitch: true
    });
    map.current.addControl(navControl, 'bottom-right');

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
    const { latitude, longitude, accuracy, heading } = userLocation;
    const userLngLat = [longitude, latitude];

    // If we have heading information, use it to show direction
    if (heading !== undefined && heading !== null) {
      userHeading.current = heading;
    }

    // Create or update the user location marker with heading indicator
    if (userLocationMarker.current) {
      userLocationMarker.current.setLngLat(userLngLat);
    } else {
      // Create a custom element for user location with direction indicator
      const el = document.createElement('div');
      el.className = 'user-location-marker';
      el.innerHTML = `
        <div class="location-dot"></div>
        <div class="location-heading"></div>
      `;
      
      userLocationMarker.current = new maplibregl.Marker({
        element: el,
        rotationAlignment: 'map'
      })
      .setLngLat(userLngLat)
      .addTo(map.current);
      
      // Apply custom styles directly
      const style = document.createElement('style');
      style.textContent = `
        .user-location-marker {
          position: relative;
          width: 24px;
          height: 24px;
        }
        .location-dot {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 14px;
          height: 14px;
          background: #007AFF;
          border: 2px solid white;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.3);
        }
        .location-heading {
          position: absolute;
          top: 0;
          left: 50%;
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-bottom: 16px solid #007AFF;
          transform-origin: center bottom;
          transform: translateX(-50%) translateY(-50%) rotate(${userHeading.current || 0}deg);
          opacity: ${userHeading.current !== null ? 1 : 0};
          transition: transform 0.5s ease;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Add accuracy radius
    if (accuracy) {
      if (userLocationRadius.current) {
        // If it exists, update the data
        if (map.current.getSource('user-accuracy')) {
          map.current.getSource('user-accuracy').setData({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: userLngLat
            },
            properties: {
              accuracy: accuracy
            }
          });
        }
      } else {
        // Add the accuracy radius as a circle
        if (mapLoaded && !map.current.getSource('user-accuracy')) {
          map.current.addSource('user-accuracy', {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: userLngLat
              },
              properties: {
                accuracy: accuracy
              }
            }
          });
          
          map.current.addLayer({
            id: 'user-accuracy-layer',
            type: 'circle',
            source: 'user-accuracy',
            paint: {
              'circle-radius': {
                property: 'accuracy',
                type: 'identity',
                default: 0
              },
              'circle-color': 'rgba(0, 122, 255, 0.15)',
              'circle-stroke-width': 1,
              'circle-stroke-color': 'rgba(0, 122, 255, 0.3)'
            }
          }, 'all-segments');
          
          userLocationRadius.current = true;
        }
      }
    }
    
    // Update heading indicator if available
    if (userHeading.current !== null && userLocationMarker.current) {
      const headingElement = userLocationMarker.current.getElement().querySelector('.location-heading');
      if (headingElement) {
        headingElement.style.transform = `translateX(-50%) translateY(-50%) rotate(${userHeading.current}deg)`;
        headingElement.style.opacity = '1';
      }
    }
    
    // Automatically follow user if followingUser is true
    if (followingUser.current) {
      const mapBounds = map.current.getBounds();
      // Don't animate if user is already in view, just update position
      if (!mapBounds.contains(userLngLat)) {
        map.current.flyTo({
          center: userLngLat,
          zoom: Math.max(map.current.getZoom(), 16),
          pitch: 45,
          bearing: userHeading.current || 0,
          speed: 1.2,
          essential: true // This ensures the animation runs even when tab is not focused
        });
      } else {
        // If user is in view but heading has changed, update bearing
        if (userHeading.current !== null) {
          map.current.easeTo({
            bearing: userHeading.current,
            duration: 300,
            essential: true
          });
        }
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

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-component-container" />
      
      {/* Map overlays for navigation experience */}
      <div className="map-compass">
        <div className="compass-inner" style={{ transform: `rotate(${map.current ? -map.current.getBearing() : 0}deg)` }}>
          <div className="compass-north">N</div>
        </div>
      </div>
    </div>
  );
}

export default MapComponent;