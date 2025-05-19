import React, { useState } from 'react';
import './FileUploadComponent.css';
import GpxParser from 'gpxparser'; // Import the gpxparser library

function FileUploadComponent({ onFileUploaded, onFileError }) {
  const [fileName, setFileName] = useState('');

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) {
      setFileName('');
      onFileError('No file selected.');
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const fileContent = e.target.result;
        if (file.name.endsWith('.geojson') || file.type === 'application/geo+json') {
          const geojsonData = JSON.parse(fileContent);
          if (geojsonData && geojsonData.features && Array.isArray(geojsonData.features)) {
            onFileUploaded(geojsonData, file.name);
          } else {
            throw new Error('Invalid GeoJSON structure. Expected a FeatureCollection.');
          }
        } else if (file.name.endsWith('.gpx')) {
          const gpx = new GpxParser();
          gpx.parse(fileContent);

          if (!gpx.tracks || gpx.tracks.length === 0) {
            throw new Error('No tracks found in GPX file.');
          }

          // Convert GPX tracks to GeoJSON FeatureCollection
          const features = gpx.tracks.flatMap(track => {
            return track.segments.map(segment => {
              // Create a LineString feature for each segment
              const coordinates = segment.points.map(p => [p.lon, p.lat]);
              return {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: coordinates,
                },
                properties: {
                  name: track.name || `Track segment ${Date.now()}`, // Use track name or a default
                  // Add any other relevant properties from the GPX track/segment if needed
                },
              };
            });
          });

          if (features.length === 0) {
            throw new Error('No valid LineString segments could be extracted from the GPX file.');
          }

          const geojsonData = {
            type: 'FeatureCollection',
            features: features,
          };
          onFileUploaded(geojsonData, file.name);

        } else {
          throw new Error('Unsupported file type. Please upload a GeoJSON or GPX file.');
        }
      } catch (error) {
        console.error('Error parsing file:', error);
        onFileError(`Error processing file "${file.name}": ${error.message}`);
        setFileName(''); // Clear file name on error
      }
    };

    reader.onerror = () => {
      onFileError(`Error reading file "${file.name}".`);
      setFileName('');
    };

    if (file.name.endsWith('.geojson') || file.type === 'application/geo+json' || file.name.endsWith('.gpx')) {
      reader.readAsText(file);
    } else {
        onFileError('Unsupported file type. Please upload a GeoJSON or GPX file.');
        setFileName('');
        event.target.value = null;
    }
  };

  return (
    <div className="file-upload-container">
      <label htmlFor="file-upload" className="file-upload-label">
        {fileName || 'Click to select undriven segments file (GeoJSON or GPX)'}
      </label>
      <input
        type="file"
        id="file-upload"
        accept=".geojson,application/geo+json,.gpx"
        onChange={handleFileChange}
        className="file-upload-input"
      />
    </div>
  );
}

export default FileUploadComponent;