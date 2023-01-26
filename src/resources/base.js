import NotImplementedError from '../errors/not_implemented';
import ValidationError from '../errors/validation';

export default (api) =>
  class Base {
    static _url = null;

    static _name = null;

    static key = null;

    static propTypes = {};

    static jsonIdKeys = [];

    _validationErrors = null;

    constructor(data = {}) {
      this.mapProps(data);
    }

    /**
     * Validates that object properties are set correctly.
     * @param {bool} throwOnFailure
     * @returns {object}
     */
    validateProperties(throwOnFailure = true) {
      this._validationErrors = null;
      const props = this.toJSON();
      const { propTypes } = this.constructor;
      const objectName = this.constructor._name;

      // Loop through proptypes and match them against props; this will catch
      // issues such as isRequired or type mismatches.
      const errors = Object.keys(propTypes).reduce((errorHash, key) => {
        const err = propTypes[key](props, key, `${objectName}`, 'prop', key);

        if (err) {
          /* eslint no-param-reassign: 0 */
          errorHash = errorHash || {};
          errorHash[key] = err.toString();
          return errorHash;
        }

        return errorHash;
      }, false);

      this._validationErrors = errors || null;

      if (errors && throwOnFailure) {
        throw new ValidationError(errors, objectName);
      }

      return errors;
    }

    /**
     * Verifies that parameters are set when required.
     * @param {*} parameters
     * @param  {...any} args
     */
    verifyParameters(parameters = {}, ...args) {
      if (parameters.this) {
        parameters.this.forEach((p) => {
          if (!this[p]) {
            throw new Error(`Object requires ${p} to be set.`);
          }
        });
      }

      if (parameters.args) {
        parameters.args.forEach((p, i) => {
          if (!args[i]) {
            throw new Error(`Missing parameter: ${p}`);
          }
        });
      }
    }

    /**
     * Creates a new NotImplementedError.
     * @param {string} fnName
     * @returns {Promise<never>}
     */
    static notImplemented(fnName) {
      return Promise.reject(new NotImplementedError(fnName, this._url));
    }

    /**
     * RPC (Remote Procedure Call) - builds the details needed to make an HTTP request.
     * @param {string} path
     * @param {object|Array} body
     * @param {string} pathPrefix
     * @param {string} method
     * @returns {*}
     */
    async rpc(path, body = undefined, pathPrefix = undefined, method = 'post') {
      const slashPath = path ? `/${path}` : '';
      const prefix = pathPrefix || this.constructor._url;
      const url = `${prefix}/${this.id}${slashPath}`;

      try {
        const response = await api[method](url, body);

        // When hitting the `/smartrate` endpoint, return the results directly
        if (path === 'smartrate') {
          return response.body.result || [];
        }

        this.mapProps(response.body);
        return this;
      } catch (e) {
        throw e;
      }
    }

    /**
     * Creates a new local object from data returned by the API.
     *
     * Unlike other libraries, this `create` object is not meant to be called by users.
     * @param {*} data
     * @returns {Base}
     */
    static create(data) {
      return new this(data);
    }

    /**
     * Save (create or update) a record.
     * @returns {this|Promise<never>}
     */
    async save() {
      try {
        this.validateProperties();

        const data = this.constructor.wrapJSON(this.toJSON());

        let response;

        if (this.id) {
          response = await api.patch(`${this._url || this.constructor._url}/${this.id}`, data);
        } else {
          response = await api.post(this._url || this.constructor._url, data);
        }

        this.mapProps(response.body);
        return this;
      } catch (e) {
        return Promise.reject(e);
      }
    }

    /**
     * Retrieve a list of records from the API.
     * @param {object} query
     * @param {string} url
     * @returns {object|Promise<never>}
     */
    static async all(query = {}, url) {
      try {
        url = url || this._url;
        const response = await api.get(url, query);
        const objectList = this.unwrapAll(response.body).map(this.create.bind(this));

        // Override the key used for reports to be the generic `reports` instead
        // of including the report type in the object key below (eg: reports/shipment).
        if (url.includes('reports')) {
          url = 'reports';
        }

        const result = {
          [url]: objectList,
          has_more: response.body.has_more,
        };
        return result;
      } catch (e) {
        return Promise.reject(e);
      }
    }

    /**
     * Retrieve a record from the API.
     * @param {string} id
     * @param {string} urlPrefix
     * @returns {Base|Promise<never>}
     */
    static async retrieve(id, urlPrefix) {
      try {
        const url = urlPrefix ? `${urlPrefix}/${id}` : `${this._url}/${id}`;
        const response = await api.get(url);
        return this.create(response.body);
      } catch (e) {
        return Promise.reject(e);
      }
    }

    /**
     * Retrieve a record from the API.
     */
    async retrieve() {
      // TODO: Deprecate this function
      if (this.id) {
        const res = await this.constructor.retrieve(this.id);
        const props = res.toJSON();

        Object.keys(props).forEach((k) => {
          this[k] = props[k];
        });
      } else {
        throw new Error('Cannot retrieve an object without an id.');
      }
    }

    /**
     * Deletes an object from the API.
     */
    async delete() {
      await this.constructor.delete(this.id);
    }

    /**
     * Deletes an object from the API (intended for internal use only).
     * @param {string} id
     * @returns {Promise|Promise<never>}
     */
    static async delete(id) {
      // TODO: Make this function internal only
      // TODO: Deprecate this function
      if (!id) {
        throw new Error(`No id was passed into ${this._name} delete()`);
      }

      try {
        return await api.del(`${this._url}/${id}`);
      } catch (e) {
        return Promise.reject(e);
      }
    }

    /**
     * Map data props to `this`, so that it can be used easily.
     *
     * TODO: cross browser proxy support and do neat getter/setter things. For
     * now, just map it on the instance.
     * @param {*} data
     */
    mapProps(data) {
      Object.keys(data).forEach((key) => {
        this[key] = data[key];
      });
    }

    /**
     * Unwraps the response from an `/all` call.
     * @param {*} data
     * @returns {Array|Base}
     */
    static unwrapAll(data) {
      if (Array.isArray(data)) return data;
      return data[this._url];
    }

    /**
     * Wraps JSON in a nested object.
     * @param {object} json
     * @returns {object}
     */
    static wrapJSON(json) {
      return { [this.key]: json };
    }

    /**
     * Converts an object to JSON.
     * @returns {object}
     */
    toJSON() {
      const idKeys = this.constructor.jsonIdKeys;

      return Object.keys(this.constructor.propTypes).reduce((json, key) => {
        if (this[key]) {
          // If providing an ID of an object as a parameter to another object,
          // wrap the ID so the API can use the object reference correctly.
          if (idKeys.includes(key) && typeof this[key] !== 'object' && this[key].includes('_')) {
            json[key] = { id: this[key] };
            return json;
          }

          // If providing an object as a parameter to another object, only pass along
          // the ID so the API will use the object reference correctly.
          if (idKeys.includes(key) && this[key].id) {
            json[key] = { id: this[key].id };
            return json;
          }

          // unwrap the json if it's an object instance
          if (this[key].toJSON) {
            json[key] = this[key].toJSON();
            return json;
          }

          json[key] = this[key];
          return json;
        }

        return json;
      }, {});
    }
  };
