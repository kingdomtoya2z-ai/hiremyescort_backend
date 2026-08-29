import { State } from "../models/statesCitiesModel.js";
import { escapeRegex, ensureString } from "../utils/sanitize.js";

export const addState = async (req, res) => {
  try {
    const name = ensureString(req.body.name);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "State name is required",
      });
    }

    // Check if state already exists
    const existingState = await State.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(name)}$`, "i") },
    });

    if (existingState) {
      return res.status(400).json({
        success: false,
        message: "State already exists",
      });
    }

    const newState = await State.create({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      cities: [],
    });

    return res.status(201).json({
      success: true,
      message: "State added successfully",
      state: newState,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const addCityToState = async (req, res) => {
  try {
    const stateName = ensureString(req.body.stateName);
    const cityName = ensureString(req.body.cityName);

    if (!stateName || !cityName) {
      return res.status(400).json({
        success: false,
        message: "State name and city name are required",
      });
    }

    // Find state (case-insensitive)
    const state = await State.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(stateName)}$`, "i") },
    });

    if (!state) {
      return res.status(404).json({
        success: false,
        message: "State not found",
      });
    }

    // Check if city already exists in this state
    const cityExists = state.cities.some(
      (city) => city.name.toLowerCase() === cityName.toLowerCase(),
    );

    if (cityExists) {
      return res.status(400).json({
        success: false,
        message: "City already exists in this state",
      });
    }

    // Add city to state
    state.cities.push({
      name: cityName.charAt(0).toUpperCase() + cityName.slice(1),
      locations: [],
      isTopCity: false,
    });

    await state.save();

    return res.status(200).json({
      success: true,
      message: "City added successfully",
      state,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getAllStates = async (req, res) => {
  try {
    const states = await State.find().sort({ name: 1 });

    return res.status(200).json({
      success: true,
      states,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getCitiesByState = async (req, res) => {
  try {
    const stateName = ensureString(req.params.stateName);

    const state = await State.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(stateName)}$`, "i") },
    });

    if (!state) {
      return res.status(404).json({
        success: false,
        message: "State not found",
      });
    }

    return res.status(200).json({
      success: true,
      cities: state.cities,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
export const deleteState = async (req, res) => {
  try {
    const { stateId } = req.params;

    const state = await State.findByIdAndDelete(stateId);

    if (!state) {
      return res.status(404).json({
        success: false,
        message: "State not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "State deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteCity = async (req, res) => {
  try {
    const { stateId, cityName } = req.body;

    const state = await State.findById(stateId);

    if (!state) {
      return res.status(404).json({
        success: false,
        message: "State not found",
      });
    }

    // Find and remove city
    const cityIndex = state.cities.findIndex(
      (city) => city.name.toLowerCase() === cityName.toLowerCase(),
    );

    if (cityIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "City not found",
      });
    }

    state.cities.splice(cityIndex, 1);
    await state.save();

    return res.status(200).json({
      success: true,
      message: "City deleted successfully",
      state,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateCitySEO = async (req, res) => {
  try {
    const {
      title,
      description,
      keywords,
      htmlSnippet,
      linkTag,
      stateName,
      cityName,
    } = req.body;

    const safeStateName = ensureString(stateName);
    const safeCityName = ensureString(cityName);

    if (!safeStateName || !safeCityName) {
      return res.status(400).json({
        success: false,
        message: "State name and city name are required",
      });
    }

    const state = await State.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(safeStateName)}$`, "i") },
    });

    if (!state) {
      return res.status(404).json({
        success: false,
        message: "State not found",
      });
    }

    if (!Array.isArray(state.cities)) {
      state.cities = [];
    }

    const normalizedSearchCity = safeCityName.toLowerCase().trim();

    const cityIndex = state.cities.findIndex((c) => {
      const normalizedCityName = (c.name || "").toLowerCase().trim();

      return (
        normalizedCityName === normalizedSearchCity ||
        normalizedCityName.replace(/\s+/g, " ") ===
          normalizedSearchCity.replace(/\s+/g, " ")
      );
    });

    if (cityIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "City not found",
      });
    }

    state.cities[cityIndex].seo = {
      title: title || "",
      description: description || "",
      keywords: keywords || "",
      htmlSnippet: htmlSnippet || "",
      linkTag: linkTag || "",
    };

    await state.save();

    return res.status(200).json({
      success: true,
      message: "City SEO updated successfully",
      city: state.cities[cityIndex],
    });
  } catch (error) {
    console.error("updateCitySEO error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getCitySEO = async (req, res) => {
  try {
    const stateName = ensureString(req.query.stateName);
    const cityName = ensureString(req.query.cityName);

    if (!stateName || !cityName) {
      return res.status(400).json({
        success: false,
        message: "State name and city name are required",
      });
    }

    // Find state
    const state = await State.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(stateName)}$`, "i") },
    });

    if (!state) {
      return res.status(404).json({
        success: false,
        message: "State not found",
      });
    }

    // Find city in state with better matching (trim and normalize)
    const normalizedSearchCity = cityName.toLowerCase().trim();
    const city = state.cities.find((c) => {
      const normalizedCityName = c.name.toLowerCase().trim();
      // Try exact match first
      if (normalizedCityName === normalizedSearchCity) return true;
      // Try partial match for cities with multiple words
      return (
        normalizedCityName.replace(/\s+/g, " ") ===
        normalizedSearchCity.replace(/\s+/g, " ")
      );
    });

    if (!city) {
      return res.status(200).json({
        success: true,
        seo: {
          title: "",
          description: "",
          keywords: "",
          htmlSnippet: "",
          linkTag: "",
        },
        message: `No SEO data found for ${cityName}, returning empty SEO object`,
      });
    }

    return res.status(200).json({
      success: true,
      seo: city.seo || {
        title: "",
        description: "",
        keywords: "",
        htmlSnippet: "",
        linkTag: "",
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const toggleTopCity = async (req, res) => {
  try {
    const { stateId, cityId, isTopCity } = req.body;

    if (!stateId || !cityId) {
      return res.status(400).json({
        success: false,
        message: "State ID and City ID are required",
      });
    }

    const state = await State.findById(stateId);

    if (!state) {
      return res.status(404).json({
        success: false,
        message: "State not found",
      });
    }

    const city = state.cities.id(cityId);

    if (!city) {
      return res.status(404).json({
        success: false,
        message: "City not found",
      });
    }

    city.isTopCity = isTopCity;
    await state.save();

    return res.status(200).json({
      success: true,
      message: "City top status updated successfully",
      city,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getTopCities = async (req, res) => {
  try {
    const states = await State.find();

    const topCities = [];

    states.forEach((state) => {
      const stateTopCities = state.cities
        .filter((city) => city.isTopCity)
        .map((city) => ({
          ...city.toObject(),
          stateName: state.name,
          stateId: state._id,
        }));
      topCities.push(...stateTopCities);
    });

    return res.status(200).json({
      success: true,
      topCities,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getTopCitiesByState = async (req, res) => {
  try {
    const stateName = ensureString(req.query.stateName);

    if (!stateName) {
      return res.status(400).json({
        success: false,
        message: "State name is required",
      });
    }

    const state = await State.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(stateName)}$`, "i") },
    });

    if (!state) {
      return res.status(404).json({
        success: false,
        message: "State not found",
      });
    }

    const topCities = state.cities.filter((city) => city.isTopCity);

    return res.status(200).json({
      success: true,
      topCities,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const addLocationToCity = async (req, res) => {
  try {
    const stateName = ensureString(req.body.stateName);
    const cityName = ensureString(req.body.cityName);
    const locationName = ensureString(req.body.locationName);

    if (!stateName || !cityName || !locationName) {
      return res.status(400).json({
        success: false,
        message: "State name, city name, and location name are required",
      });
    }

    // Find state (case-insensitive)
    const state = await State.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(stateName)}$`, "i") },
    });

    if (!state) {
      return res.status(404).json({
        success: false,
        message: "State not found",
      });
    }

    // Find city in state (case-insensitive)
    const city = state.cities.find(
      (c) => c.name.toLowerCase() === cityName.toLowerCase(),
    );

    if (!city) {
      return res.status(404).json({
        success: false,
        message: "City not found in this state",
      });
    }

    // Check if location already exists in this city
    const locationExists = city.locations.some(
      (loc) => loc.name.toLowerCase() === locationName.toLowerCase(),
    );

    if (locationExists) {
      return res.status(400).json({
        success: false,
        message: "Location already exists in this city",
      });
    }

    // Add location to city
    city.locations.push({
      name: locationName.charAt(0).toUpperCase() + locationName.slice(1),
      createdAt: new Date(),
    });

    await state.save();

    return res.status(200).json({
      success: true,
      message: "Location added successfully",
      city,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getLocationsByCity = async (req, res) => {
  try {
    const stateName = ensureString(req.query.stateName);
    const cityName = ensureString(req.query.cityName);

    if (!stateName || !cityName) {
      return res.status(400).json({
        success: false,
        message: "State name and city name are required",
      });
    }

    // Find state (case-insensitive)
    const state = await State.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(stateName)}$`, "i") },
    });

    if (!state) {
      return res.status(404).json({
        success: false,
        message: `State "${stateName}" not found`,
      });
    }

    // Find city in state (case-insensitive)
    const city = state.cities.find(
      (c) => c.name.toLowerCase() === cityName.toLowerCase(),
    );

    if (!city) {
      return res.status(404).json({
        success: false,
        message: `City "${cityName}" not found in state "${stateName}"`,
      });
    }

    // Return success with locations (empty array if no locations yet)
    const locations = city.locations || [];
    return res.status(200).json({
      success: true,
      locations: locations,
      message: `Found ${locations.length} location(s) in ${cityName}`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteLocation = async (req, res) => {
  try {
    const stateName = ensureString(req.body.stateName);
    const cityName = ensureString(req.body.cityName);
    const locationName = ensureString(req.body.locationName);

    if (!stateName || !cityName || !locationName) {
      return res.status(400).json({
        success: false,
        message: "State name, city name, and location name are required",
      });
    }

    // Find state (case-insensitive)
    const state = await State.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(stateName)}$`, "i") },
    });

    if (!state) {
      return res.status(404).json({
        success: false,
        message: "State not found",
      });
    }

    // Find city in state (case-insensitive)
    const city = state.cities.find(
      (c) => c.name.toLowerCase() === cityName.toLowerCase(),
    );

    if (!city) {
      return res.status(404).json({
        success: false,
        message: "City not found in this state",
      });
    }

    // Find and remove location
    const locationIndex = city.locations.findIndex(
      (loc) => loc.name.toLowerCase() === locationName.toLowerCase(),
    );

    if (locationIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Location not found in this city",
      });
    }

    city.locations.splice(locationIndex, 1);
    await state.save();

    return res.status(200).json({
      success: true,
      message: "Location deleted successfully",
      city,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
