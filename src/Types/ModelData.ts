import { AcademicPaper } from "./AcademicPaper"

export interface ModelData {
  firstOrderCodes?: string[]
  secondOrderCodes?: { [key: string]: string[] }
  aggregateDimensions?: { [key: string]: string[] }
  modelDescription?: string
  modelVisualization?: string
  remarks?: string
  papers?: AcademicPaper[]
}
