import React, { useState } from 'react';
import './FileUploadComponent.css';

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
        // For now, we only parse GeoJSON
        if (file.name.endsWith('.geojson') || file.type === 'application/geo+json') {
          const geojsonData = JSON.parse(e.target.result);
          if (geojsonData && geojsonData.features && Array.isArray(geojsonData.features)) {
            // Basic validation: ensure it's a FeatureCollection with features
            onFileUploaded(geojsonData, file.name);
          } else {
            throw new Error('Invalid GeoJSON structure. Expected a FeatureCollection.');
          }
        } else if (file.name.endsWith('.gpx')) {
          // Placeholder for GPX parsing
          // We'll add gpxParser logic here in a later step
          console.log('GPX file selected, parsing not yet implemented in this step.');
          onFileError(`GPX parsing for "${file.name}" is not implemented yet.`);
          // For now, treat as an error or unhandled file
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
        // Clear the file input
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