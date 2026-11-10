/**
 * Dynamic additions on top of app.json.
 * Google sign-in on iOS needs the reversed iOS OAuth client ID as a URL scheme. Set
 * EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (EAS env var) to the iOS client ID from Firebase
 * (…apps.googleusercontent.com) and the plugin is added automatically; without it, the
 * Google button is simply hidden on iOS.
 */
module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!iosClientId) return config;
  const id = iosClientId.replace(/\.apps\.googleusercontent\.com$/, '');
  return {
    ...config,
    plugins: [...(config.plugins ?? []), ['@react-native-google-signin/google-signin', { iosUrlScheme: `com.googleusercontent.apps.${id}` }]],
  };
};
