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

  // Get the next instruction to display prominently
  const getNextInstruction = () => {
    if (!routeInstructions || routeInstructions.length === 0) return null;
    return routeInstructions[0];
  };

  const nextInstruction = getNextInstruction();

  // Get the distance to next maneuver in human-readable format
  const getDistanceText = (distance) => {
    if (!distance) return '';
    const distanceFeet = Math.round(distance * 3.28084);
    if (distanceFeet > 5280) {
      return `${(distanceFeet / 5280).toFixed(1)} mi`;
    } else {
      return `${distanceFeet} ft`;
    }
  };

  // State for the navigation panel (expanded/collapsed)
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);

  // Function to toggle panel expansion
  const togglePanel = () => {
    setIsPanelExpanded(!isPanelExpanded);
  };

  // Handle file upload overlay
  const [showFileUpload, setShowFileUpload] = useState(!segments);
  
  return (
    <div className="App">
      <div className="map-container">
        <MapComponent
          segments={segments}
          userLocation={userLocation}
          routeGeoJSON={currentRoute}
          completedSegmentIds={completedSegmentIds}
          targetSegmentId={targetSegmentData ? targetSegmentData.id : null}
          isNewSegmentsData={segments !== prevSegmentsRef.current && segments !== null}
        />
        
        {/* Top navigation bar */}
        <div className="nav-header">
          <div className="nav-header-content">
            <h1>Every Street</h1>
            {currentFileName && <span className="filename">{currentFileName}</span>}
          </div>
          {userLocation && (
            <div className="current-location-button" onClick={() => document.getElementById('recenter-map').click()}>
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0013 3.06V1h-2v2.06A8.994 8.994 0 003.06 11H1v2h2.06A8.994 8.994 0 0011 20.94V23h2v-2.06A8.994 8.994 0 0020.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" fill="currentColor"/>
              </svg>
            </div>
          )}
        </div>
        
        {/* Status and error message overlay */}
        {(uploadError || (!segments && !showFileUpload)) && (
          <div className="status-overlay">
            {uploadError ? (
              <div className="error-message">Upload Error: {uploadError}</div>
            ) : (
              <div className="status-message">{statusMessage}</div>
            )}
          </div>
        )}
        
        {/* Main navigation UI */}
        {nextInstruction && !isPanelExpanded && (
          <div className="navigation-card">
            <div className="next-maneuver">
              <div className="maneuver-icon">
                {/* Icon based on maneuver type */}
                {nextInstruction.maneuver.type === 'turn' && (
                  <svg viewBox="0 0 24 24" width="40" height="40">
                    <path d={nextInstruction.maneuver.modifier.includes('right') ? 
                      "M9 5.5c0 .28.22.5.5.5h6.5a1 1 0 0 1 1 1v10.5h-2l3 3 3-3h-2V7c0-1.1-.9-2-2-2h-6.5a.5.5 0 0 0-.5.5z" : 
                      "M15 5.5c0 .28-.22.5-.5.5H8a1 1 0 0 0-1 1v10.5h2l-3 3-3-3h2V7c0-1.1.9-2 2-2h6.5c.28 0 .5.22.5.5z"} 
                      fill="white" transform={nextInstruction.maneuver.modifier === 'slight right' ? "rotate(-45, 12, 12)" : 
                      nextInstruction.maneuver.modifier === 'slight left' ? "rotate(45, 12, 12)" : ""}
                    />
                  </svg>
                )}
                {nextInstruction.maneuver.type === 'continue' && (
                  <svg viewBox="0 0 24 24" width="40" height="40">
                    <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z" fill="white"/>
                  </svg>
                )}
                {/* Additional icons for other maneuver types could be added */}
              </div>
              <div className="distance-to-maneuver">
                {getDistanceText(nextInstruction.distance)}
              </div>
            </div>
            <div className="instruction-text">
              {nextInstruction.instruction}
            </div>
            <div className="panel-toggle" onClick={togglePanel}>
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" fill="currentColor"/>
              </svg>
            </div>
          </div>
        )}
        
        {/* Expanded navigation panel with all instructions */}
        {isPanelExpanded && (
          <div className="navigation-panel">
            <div className="panel-header">
              <h3>Turn-by-Turn Directions</h3>
              <div className="panel-close" onClick={togglePanel}>
                <svg viewBox="0 0 24 24" width="24" height="24">
                  <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" fill="currentColor"/>
                </svg>
              </div>
            </div>
            <div className="instructions-list">
              {routeInstructions.map((step, index) => (
                <div key={index} className={`instruction-item ${index === 0 ? 'current' : ''}`}>
                  <div className="instruction-icon">
                    {/* Simplified icon based on maneuver type */}
                    <svg viewBox="0 0 24 24" width="24" height="24">
                      <path d={step.maneuver.type === 'turn' && step.maneuver.modifier.includes('right') ? 
                        "M9 5.5c0 .28.22.5.5.5h6.5a1 1 0 0 1 1 1v10.5h-2l3 3 3-3h-2V7c0-1.1-.9-2-2-2h-6.5a.5.5 0 0 0-.5.5z" : 
                        "M15 5.5c0 .28-.22.5-.5.5H8a1 1 0 0 0-1 1v10.5h2l-3 3-3-3h2V7c0-1.1.9-2 2-2h6.5c.28 0 .5.22.5.5z"} 
                        fill={index === 0 ? "#007AFF" : "#666"}
                      />
                    </svg>
                  </div>
                  <div className="instruction-content">
                    <div className="instruction-main">{step.instruction}</div>
                    <div className="instruction-detail">{getDistanceText(step.distance)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Action buttons */}
        <div className="action-buttons">
          <button 
            className={`route-button ${isRouting ? 'loading' : ''}`}
            onClick={calculateRouteForUndrivenSegments}
            disabled={!segments || !userLocation || isRouting || !MAPBOX_ACCESS_TOKEN || MAPBOX_ACCESS_TOKEN === 'YOUR_MAPBOX_ACCESS_TOKEN_HERE' || (segments && completedSegmentIds.size === segments.features.length && segments.features.length > 0)}
          >
            {isRouting ? (
              <div className="spinner"></div>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path d="M21.71 11.29l-9-9a.996.996 0 00-1.41 0l-9 9a.996.996 0 000 1.41l9 9c.39.39 1.02.39 1.41 0l9-9a.996.996 0 000-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z" fill="currentColor"/>
                </svg>
                {segments && completedSegmentIds.size === segments.features.length && segments.features.length > 0 ? 'All Done!' : 'Start Navigation'}
              </>
            )}
          </button>
          
          <button 
            className="upload-button" 
            onClick={() => setShowFileUpload(true)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" fill="currentColor"/>
            </svg>
            Load Map
          </button>
        </div>
        
        {/* File upload overlay */}
        {showFileUpload && (
          <div className="upload-overlay">
            <div className="upload-container">
              <h2>Load Your Street Map</h2>
              <FileUploadComponent
                onFileUploaded={(data, fileName) => {
                  handleFileUploaded(data, fileName);
                  setShowFileUpload(false);
                }}
                onFileError={handleFileError}
              />
              {segments && (
                <button 
                  className="close-upload-button"
                  onClick={() => setShowFileUpload(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
        
        {/* Progress indicator */}
        {segments && (
          <div className="progress-indicator">
            <div className="progress-text">
              {completedSegmentIds.size} of {segments.features.length} segments completed
            </div>
            <div className="progress-bar-container">
              <div 
                className="progress-bar-fill" 
                style={{width: `${segments.features.length > 0 ? (completedSegmentIds.size / segments.features.length) * 100 : 0}%`}}
              ></div>
            </div>
          </div>
        )}
        
        {/* Hidden button for map recenter - triggered by the location button */}
        <button id="recenter-map" style={{display: 'none'}}></button>
      </div>
    </div>
  );
}

export default App;