import ImageKit from 'imagekit'

let _ik: ImageKit | null = null

function getIK(): ImageKit {
  if (_ik) return _ik
  _ik = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY ?? '',
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY ?? '',
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT ?? '',
  })
  return _ik
}

export interface IKUploadResult {
  url: string
  fileId: string
  name: string
  size: number
  filePath: string
  thumbnailUrl: string
  width?: number
  height?: number
  fileType: string
}

export type IKFolder = 'images' | 'videos' | 'documents' | 'thumbnails'

export async function uploadToImageKit(
  file: Buffer,
  fileName: string,
  folder: IKFolder,
): Promise<IKUploadResult> {
  const ik = getIK()
  const result = await ik.upload({
    file: file.toString('base64'),
    fileName,
    folder: `/habexa/${folder}`,
    useUniqueFileName: true,
    tags: ['habexa', folder],
  })

  return {
    url: result.url,
    fileId: result.fileId,
    name: result.name,
    size: result.size,
    filePath: result.filePath,
    thumbnailUrl: result.thumbnailUrl,
    fileType: result.fileType,
  }
}

export async function deleteFromImageKit(fileId: string): Promise<void> {
  const ik = getIK()
  await ik.deleteFile(fileId)
}

export function getImageKitAuthParams(): {
  token: string
  expire: number
  signature: string
} {
  const ik = getIK()
  return ik.getAuthenticationParameters()
}

export function buildImageKitUrl(
  path: string,
  transformations?: { width?: number; height?: number; quality?: number; format?: string },
): string {
  const ik = getIK()
  const tr: Array<{ [key: string]: string | number }> = []
  if (transformations?.width) tr.push({ width: transformations.width })
  if (transformations?.height) tr.push({ height: transformations.height })
  if (transformations?.quality) tr.push({ quality: transformations.quality })
  if (transformations?.format) tr.push({ format: transformations.format })

  return ik.url({ path, transformation: tr })
}
