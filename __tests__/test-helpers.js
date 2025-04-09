export const mockGoogleDriveFile = (name, mimeType, content) => ({
  id: `mock-${name}-id`,
  name,
  mimeType,
  content
});

export const mockMealieRecipe = (name, tags = []) => ({
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  tags,
  groupId: 'mock-group-id'
});

export const mockFetchResponse = (data, ok = true, status = 200) => ({
  ok,
  status,
  statusText: ok ? 'OK' : 'Error',
  json: async () => data
});