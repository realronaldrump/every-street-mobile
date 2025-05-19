/* global process */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import FileUploadComponent from './components/FileUploadComponent';
import MapComponent from './components/MapComponent';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';

// Access the token from environment variables
const MAPBOX_ACCESS_TOKEN = process.env.REACT_APP_MAPBOX_ACCESS_TOKEN;

// Threshold for considering the end of a segment as "reached" (in feet)
const COMPLETION_THRESHOLD_FEET = 100; // Approximately 30 meters

if (MAPBOX_ACCESS_TOKEN === 'YOUR_MAPBOX_ACCESS_TOKEN_HERE') { // This check is for the placeholder
  console.warn(
    'Mapbox Access Token for Directions API is not set in App.jsx. Routing will not work.'
  );
}

function App() {
  const [segments, setSegments] = useState(null); 
  const [currentFileName, setCurrentFileName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [statusMessage, setStatusMessage] = useState('Please upload a file to begin.');
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
          setStatusMessage(`Location: ${newLocation.latitude.toFixed(4)}, ${newLocation.longitude.toFixed(4)}`);
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

  const calculateRouteToAndAlongNearestSegment = useCallback(async () => {
    if (!segments || !segments.features || segments.features.length === 0) {
      setStatusMessage("No segments loaded."); return;
    }
    if (!userLocation) {
      setStatusMessage("User location not available."); return;
    }
    if (MAPBOX_ACCESS_TOKEN === 'YOUR_MAPBOX_ACCESS_TOKEN_HERE') {
      setStatusMessage("Mapbox Access Token for Directions not set."); return;
    }

    setIsRouting(true);
    setStatusMessage("Calculating route...");
    setCurrentRoute(null);
    setRouteInstructions([]);
    setTargetSegmentData(null);
    nearTargetSegmentStart.current = false;

    try {
      const userPt = turf.point([userLocation.longitude, userLocation.latitude]);
      let nearestUndrivenSegmentFeature = null;
      let minDistanceToStart = Infinity;

      segments.features.forEach(segmentFeat => {
        const segmentId = segmentFeat.properties.unique_app_id;
        if (completedSegmentIds.has(segmentId)) return; 

        if (segmentFeat.geometry.type === 'LineString' && segmentFeat.geometry.coordinates.length >= 2) {
          const firstCoord = segmentFeat.geometry.coordinates[0];
          const segmentStartPt = turf.point(firstCoord);
          const distance = turf.distance(userPt, segmentStartPt, { units: 'miles' });
          if (distance < minDistanceToStart) {
            minDistanceToStart = distance;
            nearestUndrivenSegmentFeature = segmentFeat;
          }
        }
      });

      if (!nearestUndrivenSegmentFeature) {
        const allSegmentsCount = segments.features.length;
        setStatusMessage(completedSegmentIds.size === allSegmentsCount && allSegmentsCount > 0 ? "All segments completed!" : "No undriven segments found.");
        setIsRouting(false);
        return;
      }
      
      const targetId = nearestUndrivenSegmentFeature.properties.unique_app_id;
      console.log("App.jsx: Routing to target segment ID:", targetId);
      setTargetSegmentData({ id: targetId, feature: nearestUndrivenSegmentFeature });

      const segmentCoords = nearestUndrivenSegmentFeature.geometry.coordinates;
      const segmentStart = segmentCoords[0];
      const segmentEnd = segmentCoords[segmentCoords.length - 1];
      const waypoints = [
        `${userLocation.longitude},${userLocation.latitude}`,
        `${segmentStart[0]},${segmentStart[1]}`,
        `${segmentEnd[0]},${segmentEnd[1]}`
      ].join(';');
      
      const apiUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${waypoints}?steps=true&geometries=geojson&overview=full&access_token=${MAPBOX_ACCESS_TOKEN}`;
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
        const segmentName = nearestUndrivenSegmentFeature.properties?.name || `Segment ID ${targetId}`;
        setStatusMessage(`Route to "${segmentName}" calculated. (${(routeData.distance * 0.000621371).toFixed(1)} mi).`);
      } else {
        throw new Error(json.message || "No route found by Mapbox Directions API.");
      }
    } catch (error) {
      console.error("App.jsx: Routing error:", error);
      setStatusMessage(`Routing Error: ${error.message}`);
      setCurrentRoute(null);
      setRouteInstructions([]);
      setTargetSegmentData(null);
    } finally {
      setIsRouting(false);
    }
  }, [segments, userLocation, completedSegmentIds]);

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
            onClick={calculateRouteToAndAlongNearestSegment}
            disabled={!segments || !userLocation || isRouting || MAPBOX_ACCESS_TOKEN === 'YOUR_MAPBOX_ACCESS_TOKEN_HERE' || (segments && completedSegmentIds.size === segments.features.length && segments.features.length > 0)}
          >
            {isRouting ? 'Routing...' : (segments && completedSegmentIds.size === segments.features.length && segments.features.length > 0 ? 'All Done!' : 'Route Next Undriven')} 
          </button>
        </div>
        <div className="status-bar-header">
          <p>{statusMessage}</p>
          {uploadError && <p className="error-message">Upload Error: {uploadError}</p>}
        </div>
      </header>
      <main className="App-main-content">
        <div className="map-area">
          <MapComponent
            segments={segments}
            userLocation={userLocation}
            routeGeoJSON={currentRoute}
            completedSegmentIds={completedSegmentIds} // Still pass these
            targetSegmentId={targetSegmentData ? targetSegmentData.id : null} // Still pass this
            isNewSegmentsData={segments !== prevSegmentsRef.current && segments !== null}
          />
        </div>
        {routeInstructions.length > 0 && (
          <div className="instructions-panel">
            <h3>Turn-by-Turn</h3>
            <ul>
              {routeInstructions.map((step, index) => (
                <li key={index}>
                  {step.instruction} ({Math.round(step.distance * 3.28084)} feet, {Math.round(step.duration)} seconds)
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;