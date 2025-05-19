import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import FileUploadComponent from './components/FileUploadComponent';
import MapComponent from './components/MapComponent';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';

// Access the token from environment variables (Vite-specific)
const MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

// Threshold for considering the end of a segment as "reached" (in feet)
const COMPLETION_THRESHOLD_FEET = 100; // Approximately 30 meters

if (!MAPBOX_ACCESS_TOKEN || MAPBOX_ACCESS_TOKEN === 'YOUR_MAPBOX_ACCESS_TOKEN_HERE') { // Check if token is missing or is the placeholder
  console.warn(
    'Mapbox Access Token for Directions API is not set in App.jsx. Routing will not work.'
  );
}

function App() {
  // Renamed from comprehensiveRoute, comprehensiveRouteInstructions to align with existing state
  // These will store the route for all undriven segments
  const [segments, setSegments] = useState(null); 
  const [currentFileName, setCurrentFileName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [statusMessage, setStatusMessage] = useState('Acquiring location and awaiting file upload...');
  const [userLocation, setUserLocation] = useState(null);
  const [currentRoute, setCurrentRoute] = useState(null);
  const [routeInstructions, setRouteInstructions] = useState([]);
  const [isRouting, setIsRouting] = useState(false);
  
  const [targetSegmentData, setTargetSegmentData] = useState(null); 
  const [completedSegmentIds, setCompletedSegmentIds] = useState(new Set());

  const nearTargetSegmentStart = useRef(false);
  const prevSegmentsRef = useRef(); 

  useEffect(() => {
    let watchId = null;
    if (!navigator.geolocation) {
      setStatusMessage("Geolocation is not supported.");
      return;
    }
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const newLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        console.log('App.jsx: User location obtained:', newLocation);
        setUserLocation(newLocation);

        if (targetSegmentData && targetSegmentData.feature && newLocation && !isRouting) {
          const targetFeature = targetSegmentData.feature;
          if (targetFeature.geometry.type === 'LineString' && targetFeature.geometry.coordinates.length >= 2) {
            const userPt = turf.point([newLocation.longitude, newLocation.latitude]);
            const segmentCoords = targetFeature.geometry.coordinates;
            const segmentStartPtCoords = segmentCoords[0];
            const segmentEndPtCoords = segmentCoords[segmentCoords.length - 1];
            const segmentStartPt = turf.point(segmentStartPtCoords);
            const segmentEndPt = turf.point(segmentEndPtCoords);
            const distToStart = turf.distance(userPt, segmentStartPt, { units: 'feet' });
            const distToEnd = turf.distance(userPt, segmentEndPt, { units: 'feet' });

            if (distToStart < COMPLETION_THRESHOLD_FEET * 1.5) {
                nearTargetSegmentStart.current = true;
            }

            if (nearTargetSegmentStart.current && distToEnd < COMPLETION_THRESHOLD_FEET) {
              if (!completedSegmentIds.has(targetSegmentData.id)) {
                console.log(`App.jsx: Segment ${targetSegmentData.id} completion detected.`);
                setCompletedSegmentIds(prevIds => new Set(prevIds).add(targetSegmentData.id));
                const segmentName = targetFeature.properties?.name || `Segment ID ${targetSegmentData.id}`;
                setStatusMessage(`Segment "${segmentName}" completed!`);
                
                setTargetSegmentData(null); 
                setCurrentRoute(null);
                setRouteInstructions([]);
                nearTargetSegmentStart.current = false; 
              }
            }
          }
        } else if (!uploadError && !currentFileName && !isRouting && routeInstructions.length === 0) {
          setStatusMessage(`Location: ${newLocation.latitude.toFixed(4)}, ${newLocation.longitude.toFixed(4)}. Accuracy: ${newLocation.accuracy.toFixed(1)}m. Awaiting file.`);
        }
      },
      (error) => { 
        console.error("App.jsx: Geolocation error:", error);
        setStatusMessage(`Location Error: ${error.message}`);
        setUserLocation(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    return () => { if (watchId) navigator.geolocation.clearWatch(watchId); };
  }, [
    uploadError, currentFileName, isRouting, routeInstructions.length, 
    targetSegmentData, completedSegmentIds
  ]);

  const getSegmentIdFromFeature = (feature, index) => {
    if (feature.properties) {
        if (feature.properties.unique_app_id) return feature.properties.unique_app_id;
        const potentialIds = ['id', 'ID', 'segment_id', 'OBJECTID', 'objectid', 'osm_id'];
        for (const idKey of potentialIds) {
            if (feature.properties[idKey] !== undefined && feature.properties[idKey] !== null) {
                return String(feature.properties[idKey]);
            }
        }
    }
    if (feature.id !== undefined && feature.id !== null) return String(feature.id);
    return `generated_segment_${index}_${Math.random().toString(36).substring(2, 7)}`;
  };

  const handleFileUploaded = (geojsonData, fileName) => {
    console.log("App.jsx: File uploaded raw features count:", geojsonData.features.length);
    const featuresWithIds = geojsonData.features.map((feat, index) => {
        const id = getSegmentIdFromFeature(feat, index);
        return {
            ...feat,
            properties: {
                ...feat.properties,
                unique_app_id: id 
            }
        };
    });
    const processedGeojsonData = { ...geojsonData, features: featuresWithIds };
    console.log("App.jsx: Processed features with unique_app_id count:", processedGeojsonData.features.length);

    setSegments(processedGeojsonData);
    setCurrentFileName(fileName);
    setUploadError('');
    setCurrentRoute(null);
    setRouteInstructions([]);
    setTargetSegmentData(null);
    setCompletedSegmentIds(new Set());
    nearTargetSegmentStart.current = false;
    setStatusMessage(`${fileName} loaded: ${processedGeojsonData.features.length} segments. Ready to route.`);
  };

  const handleFileError = (errorMessage) => {
    setSegments(null);
    setCurrentFileName('');
    setUploadError(errorMessage);
    setCurrentRoute(null);
    setRouteInstructions([]);
    setTargetSegmentData(null);
    setCompletedSegmentIds(new Set());
    nearTargetSegmentStart.current = false;
    setStatusMessage(`Error: ${errorMessage}`);
  };

  const calculateRouteForUndrivenSegments = useCallback(async () => {
    if (!segments || !segments.features || segments.features.length === 0) {
      setStatusMessage("No segments loaded."); return;
    }
    if (!userLocation) {
      setStatusMessage("User location not available."); return;
    }
    if (!MAPBOX_ACCESS_TOKEN || MAPBOX_ACCESS_TOKEN === 'YOUR_MAPBOX_ACCESS_TOKEN_HERE') {
      setStatusMessage("Mapbox Access Token (VITE_MAPBOX_ACCESS_TOKEN) is not set in .env or is a placeholder. Routing will not work."); return;
    }

    setIsRouting(true);
    setStatusMessage("Calculating route...");
    setCurrentRoute(null);
    setRouteInstructions([]);
    setTargetSegmentData(null);
    nearTargetSegmentStart.current = false;

    try {
      const undrivenSegments = segments.features.filter(
        feat => !completedSegmentIds.has(feat.properties.unique_app_id)
      );

      if (undrivenSegments.length === 0) {
        const allSegmentsCount = segments.features.length;
        setStatusMessage(completedSegmentIds.size === allSegmentsCount && allSegmentsCount > 0 ? "All segments completed!" : "No undriven segments found to route.");
        setIsRouting(false);
        return;
      }

      // Limit to ~11 segments for Mapbox API (1 user + 11*2 = 23 waypoints out of 25 max)
      const MAX_SEGMENTS_FOR_API = 11;
      const segmentsForRoute = undrivenSegments.slice(0, MAX_SEGMENTS_FOR_API);
      
      if (segmentsForRoute.length === 0) { 
          setStatusMessage("Error: No segments selected for routing despite undriven ones existing.");
          setIsRouting(false);
          return;
      }

      // Set the target for completion logic to the first segment in this new multi-segment plan
      const firstSegmentInPlan = segmentsForRoute[0];
      setTargetSegmentData({ id: firstSegmentInPlan.properties.unique_app_id, feature: firstSegmentInPlan });
      console.log("App.jsx: New target segment for completion logic:", firstSegmentInPlan.properties.unique_app_id);

      const waypointsArray = [
        `${userLocation.longitude},${userLocation.latitude}`
      ];

      segmentsForRoute.forEach(segmentFeat => {
        if (segmentFeat.geometry.type === 'LineString' && segmentFeat.geometry.coordinates.length >= 2) {
          const segmentCoords = segmentFeat.geometry.coordinates;
          // Ensure coordinates are valid numbers before adding
          if (typeof segmentCoords[0][0] === 'number' && typeof segmentCoords[0][1] === 'number' &&
              typeof segmentCoords[segmentCoords.length - 1][0] === 'number' && typeof segmentCoords[segmentCoords.length - 1][1] === 'number') {
            waypointsArray.push(`${segmentCoords[0][0]},${segmentCoords[0][1]}`); // Start of segment
            waypointsArray.push(`${segmentCoords[segmentCoords.length - 1][0]},${segmentCoords[segmentCoords.length - 1][1]}`); // End of segment
          } else {
            console.warn(`App.jsx: Invalid coordinates for segment ${segmentFeat.properties.unique_app_id}, skipping in waypoint list.`);
          }
        }
      });
      
      if (waypointsArray.length < 2) { // Must have at least user location and one other coordinate pair
          setStatusMessage("Not enough valid waypoints to calculate a route.");
          setIsRouting(false);
          return;
      }

      const waypointsString = waypointsArray.join(';');
      
      const apiUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${waypointsString}?steps=true&geometries=geojson&overview=full&access_token=${MAPBOX_ACCESS_TOKEN}`;
      const query = await fetch(apiUrl);
      const json = await query.json();

      if (json.routes && json.routes.length > 0) {
        const routeData = json.routes[0];
        setCurrentRoute({ type: 'Feature', geometry: routeData.geometry, properties: {} });
        const instructions = routeData.legs.flatMap(leg => 
          leg.steps.map(step => ({
            maneuver: step.maneuver, instruction: step.maneuver.instruction,
            distance: step.distance, duration: step.duration
          }))
        );
        setRouteInstructions(instructions);
        
        let message = `Route for ${segmentsForRoute.length} segment(s) calculated. (${(routeData.distance * 0.000621371).toFixed(1)} mi).`;
        if (undrivenSegments.length > MAX_SEGMENTS_FOR_API) {
          message += ` Showing route for the first ${MAX_SEGMENTS_FOR_API}. Total ${undrivenSegments.length} undriven.`;
        }
        setStatusMessage(message);

      } else {
        throw new Error(json.message || "No route found by Mapbox Directions API for multiple segments.");
      }
    } catch (error) {
      console.error("App.jsx: Multi-segment routing error:", error);
      setStatusMessage(`Routing Error: ${error.message}`);
      setCurrentRoute(null);
      setRouteInstructions([]);
      setTargetSegmentData(null); // Clear target on error to prevent stale data
    } finally {
      setIsRouting(false);
    }
  }, [segments, userLocation, completedSegmentIds, setStatusMessage, setIsRouting, setCurrentRoute, setRouteInstructions, setTargetSegmentData]);

  useEffect(() => {
    prevSegmentsRef.current = segments;
  }, [segments]);

  return (
    <div className="App">
      <header className="App-header">
        <h1>Every Street Mobile</h1>
        <FileUploadComponent
          onFileUploaded={handleFileUploaded}
          onFileError={handleFileError}
        />
        <div className="actions-bar">
          <button 
            onClick={calculateRouteForUndrivenSegments}
            disabled={!segments || !userLocation || isRouting || !MAPBOX_ACCESS_TOKEN || MAPBOX_ACCESS_TOKEN === 'YOUR_MAPBOX_ACCESS_TOKEN_HERE' || (segments && completedSegmentIds.size === segments.features.length && segments.features.length > 0)}
          >
            {/* Text logic remains similar, reflects current state */}
            {isRouting ? 'Routing...' : (segments && completedSegmentIds.size === segments.features.length && segments.features.length > 0 ? 'All Done!' : 'Plan Full Route')} 
          </button>
        </div>
        <div className="status-bar-header">
          <p>{statusMessage}</p>
          {uploadError && <p className="error-message">Upload Error: {uploadError}</p>}
        </div>
      </header>
      <main className="App-main-content">
        {/* This new div will be the flex container for map and instructions */}
        <div className="layout-container">
          <div className="map-area">
            <MapComponent
              segments={segments}
              userLocation={userLocation}
              routeGeoJSON={currentRoute}
              completedSegmentIds={completedSegmentIds}
              targetSegmentId={targetSegmentData ? targetSegmentData.id : null}
              isNewSegmentsData={segments !== prevSegmentsRef.current && segments !== null}
            />
          </div>
          {routeInstructions.length > 0 && (
            <div className="instructions-panel">
              <h3>Turn-by-Turn</h3>
              <ul>
                {routeInstructions.map((step, index) => (
                  <li key={index}>
                    <span className="maneuver">{step.maneuver.type} ({step.maneuver.modifier})</span>
                    {step.instruction}
                    <span className="details">{Math.round(step.distance * 3.28084)} ft, {Math.round(step.duration)} s</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;